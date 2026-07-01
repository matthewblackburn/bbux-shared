package auth

import (
	"context"
	"testing"
)

func TestSelectSender(t *testing.T) {
	// Tier 1: magic-link log wins over everything.
	if got := SelectSender(true, "rk_live_xxx", "from@ex.com", "App"); got == nil {
		t.Fatal("magicLinkLog=true should return a non-nil sender")
	} else if _, ok := got.(LogEmailSender); !ok {
		t.Fatalf("magicLinkLog=true should return LogEmailSender, got %T", got)
	}

	// Tier 2: no log, API key present → Resend.
	if got := SelectSender(false, "rk_live_xxx", "from@ex.com", "App"); got == nil {
		t.Fatal("resend key present should return a non-nil sender")
	} else if _, ok := got.(*ResendEmailSender); !ok {
		t.Fatalf("resend key should return *ResendEmailSender, got %T", got)
	}

	// Tier 3: nothing configured → nil interface (ST built-in). Must be a true
	// nil so callers' cfg.Email == nil check works (no typed-nil trap).
	if got := SelectSender(false, "", "", "App"); got != nil {
		t.Fatalf("no config should return nil EmailSender, got %T", got)
	}
}

func TestLogEmailSender(t *testing.T) {
	// LogEmailSender never errors; it just logs.
	if err := (LogEmailSender{}).SendMagicLink(context.Background(), "a@b.com", "https://link", "123456"); err != nil {
		t.Fatalf("LogEmailSender.SendMagicLink returned error: %v", err)
	}
	// It must satisfy EmailSender.
	var _ EmailSender = LogEmailSender{}
}

func TestNewResendEmailSender_Defaults(t *testing.T) {
	// Empty from → app-scoped Resend dev sender.
	s := NewResendEmailSender("rk", "", "TCMS Codes")
	if s.from != "TCMS Codes <onboarding@resend.dev>" {
		t.Fatalf("default from = %q, want app-scoped resend.dev sender", s.from)
	}
	if s.appName != "TCMS Codes" {
		t.Fatalf("appName = %q, want TCMS Codes", s.appName)
	}
	// Explicit from is preserved verbatim.
	s2 := NewResendEmailSender("rk", "bbux <login@bbux.dev>", "bbux")
	if s2.from != "bbux <login@bbux.dev>" {
		t.Fatalf("explicit from = %q, want preserved", s2.from)
	}
	// It must satisfy EmailSender.
	var _ EmailSender = (*ResendEmailSender)(nil)
}

func TestDerefOr(t *testing.T) {
	if got := derefOr(nil); got != "" {
		t.Fatalf("derefOr(nil) = %q, want empty", got)
	}
	v := "x"
	if got := derefOr(&v); got != "x" {
		t.Fatalf("derefOr(&\"x\") = %q, want x", got)
	}
}
