from retrieve import PREFILTER_MAX_PARAMS_B, prefilter

BASE_MODEL: dict = {
    "id": "acme/good-instruct",
    "contextLength": 32768,
    "toolUse": True,
    "availability": "warm",
    "availableOnPlan": True,
    "paramsB": 7,
    "hfDownloads": 1000,
}


def _model(**overrides) -> dict:
    return {**BASE_MODEL, **overrides}


def test_prefilter_keeps_a_well_formed_candidate():
    assert prefilter([_model()], "classify") == [_model()]


def test_prefilter_drops_unparsed_zero_params_b():
    """paramsB==0 means the size was never parsed, not a real 0-param model —
    letting it through breaks concurrency-cost and cost-effectiveness math
    downstream."""
    junk = _model(id="acme/unparsed-size", paramsB=0)
    assert prefilter([junk], "classify") == []


def test_prefilter_drops_negative_params_b():
    junk = _model(id="acme/bad-size", paramsB=-1)
    assert prefilter([junk], "classify") == []


def test_prefilter_still_drops_oversized_models():
    oversized = _model(id="acme/huge", paramsB=PREFILTER_MAX_PARAMS_B + 1)
    assert prefilter([oversized], "classify") == []


def test_prefilter_drops_zero_download_low_signal_junk():
    """No recorded downloads at all is treated as broken/mirror/private
    catalog metadata, not a legitimate candidate."""
    junk = _model(id="acme/zero-downloads", hfDownloads=0)
    assert prefilter([junk], "classify") == []


def test_prefilter_does_not_require_high_download_popularity():
    """The download screen is a low-signal junk filter, not a popularity
    threshold — one recorded download is enough to pass."""
    barely_seen = _model(id="acme/one-download", hfDownloads=1)
    assert prefilter([barely_seen], "classify") == [barely_seen]
