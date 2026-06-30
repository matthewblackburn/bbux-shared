package filters

import (
	"reflect"
	"testing"
)

func TestMatch_Eq(t *testing.T) {
	if !Match(OpEq, "Active", "active") {
		t.Error("eq should be case-insensitive (EqualFold)")
	}
	if Match(OpEq, "Active", "archived") {
		t.Error("eq should not match different strings")
	}
	if !Match(OpEq, "42", 42) {
		t.Error("eq should stringify numeric value")
	}
}

func TestMatch_Ne(t *testing.T) {
	if Match(OpNe, "Active", "active") {
		t.Error("ne should be false when EqualFold matches")
	}
	if !Match(OpNe, "Active", "archived") {
		t.Error("ne should be true when values differ")
	}
}

func TestMatch_Contains(t *testing.T) {
	if !Match(OpContains, "Hello World", "lo wo") {
		t.Error("contains should match case-insensitive substring")
	}
	if !Match(OpContains, "HELLO", "ell") {
		t.Error("contains should lowercase both operands")
	}
	if Match(OpContains, "abc", "xyz") {
		t.Error("contains should not match absent substring")
	}
	if !Match(OpContains, "anything", "") {
		t.Error("empty substring is contained in everything")
	}
}

func TestMatch_In(t *testing.T) {
	if !Match(OpIn, "b", []string{"a", "b", "c"}) {
		t.Error("in should match membership in []string")
	}
	if Match(OpIn, "z", []string{"a", "b"}) {
		t.Error("in should not match absent member")
	}
	if !Match(OpIn, "B", []string{"a", "b"}) {
		t.Error("in should be case-insensitive")
	}
	if !Match(OpIn, "2", []any{1, 2, 3}) {
		t.Error("in should accept []any and stringify members")
	}
	if !Match(OpIn, "solo", "solo") {
		t.Error("in should treat a scalar as a single-member set")
	}
}

func TestMatch_NumericOrdering(t *testing.T) {
	cases := []struct {
		op   Operator
		cell string
		val  any
		want bool
	}{
		{OpGt, "10", "9", true},
		{OpGt, "9", "10", false},
		{OpGte, "10", "10", true},
		{OpLt, "5", "10", true},
		{OpLte, "10", "10", true},
		{OpLte, "11", "10", false},
		// numeric beats lexicographic: "10" > "9" numerically though "1" < "9"
		{OpGt, "100", "20", true},
	}
	for _, c := range cases {
		if got := Match(c.op, c.cell, c.val); got != c.want {
			t.Errorf("Match(%s, %q, %v) = %v, want %v", c.op, c.cell, c.val, got, c.want)
		}
	}
}

func TestMatch_LexicographicWhenNonNumeric(t *testing.T) {
	if !Match(OpGt, "banana", "apple") {
		t.Error("non-numeric gt should compare lexicographically")
	}
	if !Match(OpLt, "apple", "banana") {
		t.Error("non-numeric lt should compare lexicographically")
	}
	if Match(OpGt, "apple", "apple") {
		t.Error("equal strings are not gt")
	}
}

func TestMatch_PriceStyleParse(t *testing.T) {
	if !Match(OpGt, "$1,234.50", "$999.00") {
		t.Error("price-style parse should strip $ and , before comparing")
	}
	if !Match(OpLte, "$10.00", "10") {
		t.Error("price-style 10.00 <= 10 should hold")
	}
	if !Match(OpGt, "-5", "-10") {
		t.Error("negative numbers should compare numerically")
	}
}

func TestMatch_UnknownOperator(t *testing.T) {
	if Match(Operator("nope"), "a", "a") {
		t.Error("unknown operator should return false")
	}
}

func sampleRows() []map[string]string {
	return []map[string]string{
		{"name": "Apple", "status": "active", "price": "$3.00"},
		{"name": "Banana", "status": "archived", "price": "$1.50"},
		{"name": "Cherry", "status": "active", "price": "$10.00"},
	}
}

func names(rows []map[string]string) []string {
	out := make([]string, len(rows))
	for i, r := range rows {
		out[i] = r["name"]
	}
	return out
}

func TestFilterRows_NoPredicates(t *testing.T) {
	rows := sampleRows()
	got := FilterRows(rows, nil)
	if len(got) != 3 {
		t.Fatalf("no predicates should return all rows, got %d", len(got))
	}
}

func TestFilterRows_SinglePredicate(t *testing.T) {
	got := FilterRows(sampleRows(), []Predicate{{Key: "status", Op: OpEq, Value: "active"}})
	if !reflect.DeepEqual(names(got), []string{"Apple", "Cherry"}) {
		t.Errorf("got %v", names(got))
	}
}

func TestFilterRows_AndSemantics(t *testing.T) {
	got := FilterRows(sampleRows(), []Predicate{
		{Key: "status", Op: OpEq, Value: "active"},
		{Key: "price", Op: OpGt, Value: "$5.00"},
	})
	if !reflect.DeepEqual(names(got), []string{"Cherry"}) {
		t.Errorf("AND of predicates failed, got %v", names(got))
	}
}

func TestFilterRows_Contains(t *testing.T) {
	got := FilterRows(sampleRows(), []Predicate{{Key: "name", Op: OpContains, Value: "an"}})
	if !reflect.DeepEqual(names(got), []string{"Banana"}) {
		t.Errorf("got %v", names(got))
	}
}

func TestFilterRows_MissingKeyTreatedAsEmpty(t *testing.T) {
	got := FilterRows(sampleRows(), []Predicate{{Key: "missing", Op: OpEq, Value: "x"}})
	if len(got) != 0 {
		t.Errorf("eq against absent key (empty cell) should match nothing, got %v", names(got))
	}
}

func TestFilterRows_DoesNotMutateInput(t *testing.T) {
	rows := sampleRows()
	_ = FilterRows(rows, []Predicate{{Key: "status", Op: OpEq, Value: "active"}})
	if len(rows) != 3 {
		t.Error("input slice was mutated")
	}
}

func TestSortRows_NumericAsc(t *testing.T) {
	got := SortRows(sampleRows(), []OrderSpec{{Key: "price"}})
	if !reflect.DeepEqual(names(got), []string{"Banana", "Apple", "Cherry"}) {
		t.Errorf("numeric asc sort failed, got %v", names(got))
	}
}

func TestSortRows_NumericDesc(t *testing.T) {
	got := SortRows(sampleRows(), []OrderSpec{{Key: "price", Desc: true}})
	if !reflect.DeepEqual(names(got), []string{"Cherry", "Apple", "Banana"}) {
		t.Errorf("numeric desc sort failed, got %v", names(got))
	}
}

func TestSortRows_Lexicographic(t *testing.T) {
	got := SortRows(sampleRows(), []OrderSpec{{Key: "name", Desc: true}})
	if !reflect.DeepEqual(names(got), []string{"Cherry", "Banana", "Apple"}) {
		t.Errorf("lexicographic desc sort failed, got %v", names(got))
	}
}

func TestSortRows_MultiKeyTiebreak(t *testing.T) {
	rows := []map[string]string{
		{"g": "a", "n": "2"},
		{"g": "b", "n": "1"},
		{"g": "a", "n": "1"},
	}
	got := SortRows(rows, []OrderSpec{{Key: "g"}, {Key: "n"}})
	want := [][2]string{{"a", "1"}, {"a", "2"}, {"b", "1"}}
	for i, w := range want {
		if got[i]["g"] != w[0] || got[i]["n"] != w[1] {
			t.Fatalf("multi-key sort wrong at %d: %v", i, got[i])
		}
	}
}

func TestSortRows_StableAndNonMutating(t *testing.T) {
	rows := sampleRows()
	got := SortRows(rows, nil)
	if !reflect.DeepEqual(names(got), names(rows)) {
		t.Error("no specs should preserve order")
	}
	// The returned slice must be independent of the input slice (a copy):
	// reordering it must not reorder the caller's slice.
	sorted := SortRows(rows, []OrderSpec{{Key: "name", Desc: true}})
	if names(rows)[0] != "Apple" {
		t.Error("input slice order was mutated by SortRows")
	}
	if names(sorted)[0] != "Cherry" {
		t.Error("returned slice was not sorted")
	}
}
