from grade import grade


def test_compression_guard_kills_verbatim_copy_summary():
    """SPEC.md §5.4: without the compression guard, a verbatim copy of the
    source trivially contains every must-contain fact and scores 1.0. The
    guard (len(out)/len(src) <= 0.4) must zero it out regardless."""
    source = "Alpha widget shipped Monday. Beta widget shipped Tuesday. " * 5
    facts = ["Alpha widget shipped Monday", "Beta widget shipped Tuesday"]
    score = grade("summarize", source, facts, source)
    assert score == 0.0


def test_good_summary_passes_compression_guard():
    source = "Alpha widget shipped Monday to the west region team. " * 8
    facts = ["Alpha widget shipped Monday"]
    good_summary = "Alpha widget shipped Monday."
    score = grade("summarize", good_summary, facts, source)
    assert score == 1.0


def test_summarize_partial_fact_coverage():
    source = "Alpha widget shipped Monday. Beta widget shipped Tuesday. " * 8
    facts = ["Alpha widget shipped Monday", "Beta widget shipped Tuesday"]
    only_one_fact = "Alpha widget shipped Monday."
    score = grade("summarize", only_one_fact, facts, source)
    assert score == 0.5


def test_classify_exact_match():
    assert grade("classify", "billing", "billing") == 1.0
    assert grade("classify", "bug", "billing") == 0.0
    assert grade("classify", "  Billing  ", "billing") == 1.0  # case/whitespace insensitive


def test_extract_fields_partial_credit():
    gold = {"vendor": "Acme", "amount": "$5"}
    output = '{"vendor": "Acme", "amount": "$9"}'
    assert grade("extract_fields", output, gold) == 0.5


def test_extract_fields_invalid_json_scores_zero():
    gold = {"vendor": "Acme", "amount": "$5"}
    assert grade("extract_fields", "not json", gold) == 0.0


def test_normalize_token_f1():
    assert grade("normalize", "close the ticket", "close the ticket") == 1.0
    assert grade("normalize", "totally unrelated text", "close the ticket") == 0.0
