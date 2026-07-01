// Package auth is the shared SuperTokens passwordless (magic link + OTP)
// wiring used by both bbux and tcms-codes-react. It owns the GENERIC parts of
// the auth boundary — SDK init with the passwordless + session recipes, the
// anti-enumeration overrides, magic-link email delivery, and the session
// verification boilerplate — while every app-specific concern is injected via
// callbacks:
//
//   - Config.Eligible gates code creation (which emails may actually receive a
//     sign-in code). Ineligible emails get an indistinguishable fake OK so the
//     UI always advances to "check your email" without revealing whether an
//     email is a real user.
//   - Config.OnConsume links (or creates) the app's user row on first sign-in.
//   - VerifySession delegates identity resolution + error semantics to a
//     resolver so each app owns its own context shape and failure responses
//     (bbux writes 403/CLAIM_PENDING; tcms revokes sessions + writes 401).
//
// The module depends ONLY on supertokens-golang and the standard library — no
// pixelid, pgx, or ent — so it can be installed by any repo as
// github.com/matthewblackburn/bbux-shared/packages/go/auth.
package auth

import (
	"context"
	"log/slog"
	"net/http"

	"github.com/supertokens/supertokens-golang/ingredients/emaildelivery"
	"github.com/supertokens/supertokens-golang/recipe/passwordless"
	"github.com/supertokens/supertokens-golang/recipe/passwordless/plessmodels"
	"github.com/supertokens/supertokens-golang/recipe/session"
	"github.com/supertokens/supertokens-golang/recipe/session/sessmodels"
	"github.com/supertokens/supertokens-golang/supertokens"
)

// noopSession is the placeholder device/session id returned for a fake OK (an
// email that isn't eligible to sign in). Consume/resend on it can never
// succeed, but the create response is indistinguishable from a real one.
const noopSession = "noop"

// flowType is the passwordless flow: both a clickable magic link AND a
// user-input OTP code are sent.
const flowType = "USER_INPUT_CODE_AND_MAGIC_LINK"

// EmailSender delivers the passwordless sign-in email (magic link + OTP code).
// Production swaps in a real provider (e.g. Resend); dev logs the link so you
// can click it from the console. A nil EmailSender leaves delivery to
// SuperTokens' own built-in email service, which sends a real magic-link email
// with no extra config.
type EmailSender interface {
	SendMagicLink(ctx context.Context, to, link, code string) error
}

// LogEmailSender prints the magic link to the logs — the zero-dependency dev
// default. NEVER use in production.
type LogEmailSender struct{}

// SendMagicLink logs the link and code instead of emailing them.
func (LogEmailSender) SendMagicLink(_ context.Context, to, link, code string) error {
	slog.Info("magic link (dev: not actually emailed)", "to", to, "link", link, "code", code)
	return nil
}

// Config carries the SuperTokens runtime knobs plus the app-specific callbacks.
type Config struct {
	// ConnectionURI is the SuperTokens core address (e.g.
	// http://supertokens:3567 in dev, or the managed cloud URL).
	ConnectionURI string
	// APIKey authenticates to the core; empty when self-hosting in dev.
	APIKey string
	// APIDomain is where the API is served (e.g. http://localhost:8080).
	APIDomain string
	// WebsiteDomain is the frontend origin (e.g. http://localhost:3000).
	WebsiteDomain string
	// AppName is the SuperTokens AppInfo app name (e.g. "bbux", "TCMS Codes").
	AppName string

	// Email delivers the magic link. When nil, SuperTokens' built-in email
	// service is used (no override installed).
	Email EmailSender

	// Eligible reports whether an email may actually receive a sign-in code.
	// When nil, every email is treated as eligible (the original create runs,
	// no fake-OK gating). When set and it returns false, a fake OK is returned
	// (anti-enumeration) and no code is created/sent.
	Eligible func(ctx context.Context, email string) bool

	// OnConsume links (or creates) the app's user row for a verified email +
	// SuperTokens user id, on first sign-in. When nil, ConsumeCodePOST is not
	// overridden. An error returned here is logged but does NOT fail the
	// sign-in response.
	OnConsume func(ctx context.Context, email, stID string) error
}

// InitPasswordless initialises the SDK with the passwordless + session
// recipes. Call once at startup before mounting VerifySession.
func InitPasswordless(cfg Config) error {
	apiBasePath := "/auth"
	conn := supertokens.ConnectionInfo{ConnectionURI: cfg.ConnectionURI}
	if cfg.APIKey != "" {
		conn.APIKey = cfg.APIKey
	}

	plConfig := plessmodels.TypeInput{
		FlowType:           flowType,
		ContactMethodEmail: plessmodels.ContactMethodEmailConfig{Enabled: true},
		Override: &plessmodels.OverrideStruct{
			APIs: func(orig plessmodels.APIInterface) plessmodels.APIInterface {
				return overrideAPIs(cfg, orig)
			},
		},
	}

	// Email delivery: override ONLY when a custom sender is supplied (e.g. the
	// dev log sender or Resend). With no sender, SuperTokens' built-in
	// passwordless email service sends REAL magic-link emails — no SMTP wiring
	// required.
	if cfg.Email != nil {
		plConfig.EmailDelivery = &emaildelivery.TypeInput{
			Override: func(orig emaildelivery.EmailDeliveryInterface) emaildelivery.EmailDeliveryInterface {
				send := func(input emaildelivery.EmailType, _ supertokens.UserContext) error {
					if input.PasswordlessLogin == nil {
						return nil
					}
					pl := input.PasswordlessLogin
					return cfg.Email.SendMagicLink(context.Background(), pl.Email, derefOr(pl.UrlWithLinkCode), derefOr(pl.UserInputCode))
				}
				orig.SendEmail = &send
				return orig
			},
		}
	}

	return supertokens.Init(supertokens.TypeInput{
		Supertokens: &conn,
		AppInfo: supertokens.AppInfo{
			AppName:       cfg.AppName,
			APIDomain:     cfg.APIDomain,
			WebsiteDomain: cfg.WebsiteDomain,
			APIBasePath:   &apiBasePath,
		},
		RecipeList: []supertokens.Recipe{
			passwordless.Init(plConfig),
			session.Init(nil),
		},
	})
}

// overrideAPIs enforces the optional eligibility gate on code creation and
// links the app user to its ST id on consume (first sign-in).
func overrideAPIs(cfg Config, orig plessmodels.APIInterface) plessmodels.APIInterface {
	originalCreate := *orig.CreateCodePOST
	create := func(email *string, phone *string, tenantID string, options plessmodels.APIOptions, userCtx supertokens.UserContext) (plessmodels.CreateCodePOSTResponse, error) {
		// Sign-in is restricted to eligible emails. For any other email we
		// DON'T create/send a code, but we return a fake OK so the UI always
		// advances to "check your email" — never revealing whether an email is
		// a real user (anti-enumeration).
		if cfg.Eligible != nil && email != nil && !cfg.Eligible(options.Req.Context(), *email) {
			slog.Info("sign-in code skipped — email not eligible (fake OK returned)", "email", *email)
			return plessmodels.CreateCodePOSTResponse{
				OK: &struct {
					DeviceID         string
					PreAuthSessionID string
					FlowType         string
				}{
					DeviceID:         noopSession,
					PreAuthSessionID: noopSession,
					FlowType:         flowType,
				},
			}, nil
		}
		return originalCreate(email, phone, tenantID, options, userCtx)
	}
	orig.CreateCodePOST = &create

	// Resend for a fake (noop) session also succeeds silently, so the "resend
	// code" action can't be used to probe for real users either.
	originalResend := *orig.ResendCodePOST
	resend := func(deviceID string, preAuthSessionID string, tenantID string, options plessmodels.APIOptions, userCtx supertokens.UserContext) (plessmodels.ResendCodePOSTResponse, error) {
		if deviceID == noopSession || preAuthSessionID == noopSession {
			return plessmodels.ResendCodePOSTResponse{OK: &struct{}{}}, nil
		}
		return originalResend(deviceID, preAuthSessionID, tenantID, options, userCtx)
	}
	orig.ResendCodePOST = &resend

	// Link (or create) the app user for this verified email + ST id, only when
	// the app supplies an OnConsume hook.
	if cfg.OnConsume != nil {
		originalConsume := *orig.ConsumeCodePOST
		consume := func(userInput *plessmodels.UserInputCodeWithDeviceID, linkCode *string, preAuthSessionID string, tenantID string, options plessmodels.APIOptions, userCtx supertokens.UserContext) (plessmodels.ConsumeCodePOSTResponse, error) {
			resp, err := originalConsume(userInput, linkCode, preAuthSessionID, tenantID, options, userCtx)
			if err != nil || resp.OK == nil || resp.OK.User.Email == nil {
				return resp, err
			}
			if linkErr := cfg.OnConsume(options.Req.Context(), *resp.OK.User.Email, resp.OK.User.ID); linkErr != nil {
				slog.Error("OnConsume hook failed", "email", *resp.OK.User.Email, "error", linkErr)
			}
			return resp, nil
		}
		orig.ConsumeCodePOST = &consume
	}

	return orig
}

// VerifySession returns middleware that verifies the SuperTokens session and
// delegates identity resolution + error semantics to resolve. It handles the
// shared plumbing: GetSession, the missing/invalid-session 401, and extracting
// the trusted ST user id. resolve receives (w, r, stID) and returns the request
// context to bind plus an ok flag:
//
//   - ok == true  → the middleware calls next with r.WithContext(ctx).
//   - ok == false → the middleware STOPS. resolve is expected to have already
//     written the appropriate response (bbux: 403/CLAIM_PENDING; tcms: revoke
//     all sessions + 401), so this middleware writes nothing further.
func VerifySession(resolve func(w http.ResponseWriter, r *http.Request, stID string) (context.Context, bool)) func(http.Handler) http.Handler {
	return func(next http.Handler) http.Handler {
		return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
			sess, err := session.GetSession(r, w, &sessmodels.VerifySessionOptions{})
			if err != nil || sess == nil {
				http.Error(w, `{"code":"UNAUTHORIZED"}`, http.StatusUnauthorized)
				return
			}
			stID := sess.GetUserID()
			ctx, ok := resolve(w, r, stID)
			if !ok {
				return
			}
			next.ServeHTTP(w, r.WithContext(ctx))
		})
	}
}

// SelectSender chooses the magic-link delivery strategy in three tiers:
//
//  1. magicLinkLog → LogEmailSender{} (dev: log the link, never email).
//  2. else resendAPIKey != "" → NewResendEmailSender(...) (production).
//  3. else → nil EmailSender (SuperTokens' built-in email service).
//
// The nil return is an explicit nil EmailSender interface (not a typed nil), so
// callers can compare cfg.Email == nil reliably.
func SelectSender(magicLinkLog bool, resendAPIKey, resendFrom, appName string) EmailSender {
	if magicLinkLog {
		return LogEmailSender{}
	}
	if resendAPIKey != "" {
		return NewResendEmailSender(resendAPIKey, resendFrom, appName)
	}
	return nil
}

// derefOr returns *s, or "" when s is nil.
func derefOr(s *string) string {
	if s == nil {
		return ""
	}
	return *s
}
