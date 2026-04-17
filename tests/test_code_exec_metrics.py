from backend.scoring import code_exec


def test_pass_at_k_returns_success_when_later_attempt_passes(monkeypatch):
    codes = [
        "def add(a, b):\n    return a - b\n",
        "def add(a, b):\n    return a + b\n",
    ]
    tests = "assert add(2, 3) == 5\nassert add(-1, 1) == 0\n"

    def fake_pass_at_1(code: str, tests: str, timeout_s: float = 3.0):
        if "return a + b" in code:
            return 1.0, "passed"
        return 0.0, "wrong answer"

    monkeypatch.setattr(code_exec, "pass_at_1", fake_pass_at_1)

    score, attempts = code_exec.pass_at_k(codes, tests, k=3)

    assert score == 1.0
    assert len(attempts) == 2
    assert attempts[0] == (0.0, "wrong answer")
    assert attempts[1] == (1.0, "passed")


def test_pass_at_k_returns_failure_when_all_attempts_fail(monkeypatch):
    codes = [
        "def square(n):\n    return n + n\n",
        "def square(n):\n    return n - 1\n",
        "def square(n):\n    return 0\n",
    ]
    tests = "assert square(4) == 16\nassert square(1) == 1\n"

    monkeypatch.setattr(code_exec, "pass_at_1", lambda code, tests, timeout_s=3.0: (0.0, "wrong answer"))

    score, attempts = code_exec.pass_at_k(codes, tests, k=3)

    assert score == 0.0
    assert len(attempts) == 3
    assert all(result[0] == 0.0 for result in attempts)
