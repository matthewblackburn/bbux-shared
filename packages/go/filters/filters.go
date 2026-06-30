// Package rowfilter provides dependency-free operator semantics and an
// in-memory filter/sort engine over rows modeled as map[string]string.
//
// It is the Go analog of bbux's web client-data.ts: the same comparison
// contract (eq/ne/contains/in plus numeric/lexicographic ordering) expressed
// for server-side or tooling use where rows are flat string maps (e.g. CSV
// rows). It depends only on the standard library so it can be installed by
// external repos as github.com/matthewblackburn/bbux/rowfilter.
package filters

import (
	"sort"
	"strconv"
	"strings"
)

// Operator is a comparison operator applied between a row cell and a value.
type Operator string

const (
	// OpEq matches when cell equals value, case-insensitively (EqualFold).
	OpEq Operator = "eq"
	// OpNe is the negation of OpEq.
	OpNe Operator = "ne"
	// OpContains matches when value's string form is a case-insensitive
	// substring of the cell.
	OpContains Operator = "contains"
	// OpIn matches when the cell is (case-insensitively) one of the values
	// in a slice value.
	OpIn Operator = "in"
	// OpGt/OpGte/OpLt/OpLte order numerically when both operands parse as
	// numbers, else lexicographically.
	OpGt  Operator = "gt"
	OpGte Operator = "gte"
	OpLt  Operator = "lt"
	OpLte Operator = "lte"
)

// Predicate is a single filter clause: a column key, an operator, and the
// value to compare against. For OpIn, Value is typically a []string (or
// []any); other operators take a scalar (string/number/bool).
type Predicate struct {
	Key   string
	Op    Operator
	Value any
}

// OrderSpec is a single sort key: a column and direction.
type OrderSpec struct {
	Key  string
	Desc bool
}

// parsePrice strips everything but digits, a leading sign, and a single
// decimal point, then parses the result as a float. It mirrors a price-style
// parse ("$1,234.50" -> 1234.50). The bool reports whether a number was found.
func parsePrice(s string) (float64, bool) {
	var b strings.Builder
	seenDot := false
	for i, r := range s {
		switch {
		case r >= '0' && r <= '9':
			b.WriteRune(r)
		case r == '.' && !seenDot:
			seenDot = true
			b.WriteRune(r)
		case (r == '-' || r == '+') && b.Len() == 0 && i == strings.IndexAny(s, "-+"):
			b.WriteRune(r)
		}
	}
	cleaned := b.String()
	if cleaned == "" || cleaned == "-" || cleaned == "+" || cleaned == "." {
		return 0, false
	}
	f, err := strconv.ParseFloat(cleaned, 64)
	if err != nil {
		return 0, false
	}
	return f, true
}

// toString renders a scalar value to its string form for comparison.
func toString(v any) string {
	switch x := v.(type) {
	case nil:
		return ""
	case string:
		return x
	case bool:
		return strconv.FormatBool(x)
	case int:
		return strconv.Itoa(x)
	case int64:
		return strconv.FormatInt(x, 10)
	case float64:
		return strconv.FormatFloat(x, 'f', -1, 64)
	case float32:
		return strconv.FormatFloat(float64(x), 'f', -1, 64)
	default:
		return ""
	}
}

// toStringSlice coerces an OpIn value into a slice of strings. It accepts
// []string, []any (each element stringified), or a single scalar.
func toStringSlice(v any) []string {
	switch x := v.(type) {
	case []string:
		return x
	case []any:
		out := make([]string, 0, len(x))
		for _, e := range x {
			out = append(out, toString(e))
		}
		return out
	default:
		return []string{toString(v)}
	}
}

// Match reports whether cell satisfies (op, value). See the Operator docs for
// per-operator semantics. Unknown operators return false.
func Match(op Operator, cell string, value any) bool {
	switch op {
	case OpEq:
		return strings.EqualFold(cell, toString(value))
	case OpNe:
		return !strings.EqualFold(cell, toString(value))
	case OpContains:
		return strings.Contains(strings.ToLower(cell), strings.ToLower(toString(value)))
	case OpIn:
		for _, s := range toStringSlice(value) {
			if strings.EqualFold(cell, s) {
				return true
			}
		}
		return false
	case OpGt, OpGte, OpLt, OpLte:
		return compare(op, cell, toString(value))
	default:
		return false
	}
}

// compare handles the ordering operators. Numeric when both operands parse as
// (price-style) numbers, else a lexicographic compare of the raw strings.
func compare(op Operator, cell, value string) bool {
	cn, cok := parsePrice(cell)
	vn, vok := parsePrice(value)
	if cok && vok {
		switch op {
		case OpGt:
			return cn > vn
		case OpGte:
			return cn >= vn
		case OpLt:
			return cn < vn
		case OpLte:
			return cn <= vn
		}
		return false
	}
	c := strings.Compare(cell, value)
	switch op {
	case OpGt:
		return c > 0
	case OpGte:
		return c >= 0
	case OpLt:
		return c < 0
	case OpLte:
		return c <= 0
	}
	return false
}

// matchRow reports whether a row satisfies every predicate (logical AND).
func matchRow(row map[string]string, preds []Predicate) bool {
	for _, p := range preds {
		if !Match(p.Op, row[p.Key], p.Value) {
			return false
		}
	}
	return true
}

// FilterRows returns the rows that satisfy all predicates (AND). With no
// predicates, every row passes. The input slice is not mutated; the returned
// slice references the same row maps.
func FilterRows(rows []map[string]string, preds []Predicate) []map[string]string {
	if len(preds) == 0 {
		out := make([]map[string]string, len(rows))
		copy(out, rows)
		return out
	}
	out := make([]map[string]string, 0, len(rows))
	for _, r := range rows {
		if matchRow(r, preds) {
			out = append(out, r)
		}
	}
	return out
}

// SortRows returns a stably-sorted copy of rows ordered by the given specs in
// priority order (first spec is primary). Each key orders numerically when
// both cells parse as numbers, else lexicographically. The input is not
// mutated.
func SortRows(rows []map[string]string, specs []OrderSpec) []map[string]string {
	out := make([]map[string]string, len(rows))
	copy(out, rows)
	if len(specs) == 0 {
		return out
	}
	sort.SliceStable(out, func(i, j int) bool {
		for _, s := range specs {
			c := cellCompare(out[i][s.Key], out[j][s.Key])
			if c == 0 {
				continue
			}
			if s.Desc {
				return c > 0
			}
			return c < 0
		}
		return false
	})
	return out
}

// cellCompare returns -1/0/1 comparing two cells numerically when both parse
// as numbers, else lexicographically.
func cellCompare(a, b string) int {
	an, aok := parsePrice(a)
	bn, bok := parsePrice(b)
	if aok && bok {
		switch {
		case an < bn:
			return -1
		case an > bn:
			return 1
		default:
			return 0
		}
	}
	return strings.Compare(a, b)
}
