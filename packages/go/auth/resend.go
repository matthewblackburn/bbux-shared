package auth

import (
	"bytes"
	"context"
	"encoding/json"
	"fmt"
	"html"
	"log/slog"
	"net/http"
	"time"
)

// ResendEmailSender delivers magic-link emails via Resend's HTTP API
// (https://resend.com/docs/api-reference/emails/send-email). Chosen over SMTP
// so there's no long-lived connection or blocked-port surprise on Fly — a
// single authenticated POST per send. Used in production when a Resend API key
// is set; dev falls back to LogEmailSender.
type ResendEmailSender struct {
	apiKey  string
	from    string // verified sender, e.g. "bbux <login@bbux.dev>"
	appName string // used in the subject/body ("Sign in to <appName>")
	client  *http.Client
}

// NewResendEmailSender builds the sender. from must be an address on a domain
// verified in Resend (else Resend rejects the send); when empty it defaults to
// Resend's shared dev sender scoped to the app name. appName is interpolated
// into the email subject and body.
func NewResendEmailSender(apiKey, from, appName string) *ResendEmailSender {
	if from == "" {
		// Resend's shared dev sender (owner-only).
		from = appName + " <onboarding@resend.dev>"
	}
	return &ResendEmailSender{
		apiKey:  apiKey,
		from:    from,
		appName: appName,
		client:  &http.Client{Timeout: 10 * time.Second},
	}
}

type resendRequest struct {
	From    string   `json:"from"`
	To      []string `json:"to"`
	Subject string   `json:"subject"`
	HTML    string   `json:"html"`
	Text    string   `json:"text"`
}

// SendMagicLink emails the clickable link (and the fallback code) to the user.
func (s *ResendEmailSender) SendMagicLink(ctx context.Context, to, link, code string) error {
	subject := "Your " + s.appName + " sign-in link"
	text := fmt.Sprintf("Sign in to %s:\n\n%s\n\nOr enter this code: %s\n\nThis link expires shortly. If you didn't request it, ignore this email.", s.appName, link, code)
	htmlBody := fmt.Sprintf(
		`<div style="font-family:system-ui,sans-serif;max-width:480px;margin:0 auto">`+
			`<h2 style="color:#111">Sign in to %s</h2>`+
			`<p><a href="%s" style="display:inline-block;background:#ef4444;color:#fff;padding:10px 18px;border-radius:8px;text-decoration:none">Sign in</a></p>`+
			`<p style="color:#555">Or enter this code: <strong>%s</strong></p>`+
			`<p style="color:#999;font-size:12px">This link expires shortly. If you didn't request it, you can ignore this email.</p>`+
			`</div>`,
		html.EscapeString(s.appName), html.EscapeString(link), html.EscapeString(code))

	body, err := json.Marshal(resendRequest{From: s.from, To: []string{to}, Subject: subject, HTML: htmlBody, Text: text})
	if err != nil {
		return err
	}
	ctx, cancel := context.WithTimeout(ctx, 10*time.Second)
	defer cancel()
	req, err := http.NewRequestWithContext(ctx, http.MethodPost, "https://api.resend.com/emails", bytes.NewReader(body))
	if err != nil {
		return err
	}
	req.Header.Set("Authorization", "Bearer "+s.apiKey)
	req.Header.Set("Content-Type", "application/json")

	resp, err := s.client.Do(req)
	if err != nil {
		slog.Error("resend send failed (transport)", "to", to, "error", err)
		return fmt.Errorf("resend send: %w", err)
	}
	defer func() { _ = resp.Body.Close() }()
	if resp.StatusCode >= 300 {
		var buf bytes.Buffer
		_, _ = buf.ReadFrom(resp.Body)
		slog.Error("resend send rejected", "to", to, "status", resp.StatusCode, "body", buf.String())
		return fmt.Errorf("resend send: status %d: %s", resp.StatusCode, buf.String())
	}
	slog.Info("magic-link email sent via Resend", "to", to)
	return nil
}
