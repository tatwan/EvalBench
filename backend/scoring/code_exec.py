import multiprocessing as mp
from typing import List, Tuple


SAFE_BUILTINS = {
    "abs": abs,
    "all": all,
    "any": any,
    "bool": bool,
    "dict": dict,
    "enumerate": enumerate,
    "float": float,
    "int": int,
    "len": len,
    "list": list,
    "max": max,
    "min": min,
    "range": range,
    "set": set,
    "sorted": sorted,
    "str": str,
    "sum": sum,
    "tuple": tuple,
    "zip": zip,
    "print": print,
    "map": map,
    "filter": filter,
    "type": type,
    "isinstance": isinstance,
    "repr": repr,
    "hash": hash,
    "round": round,
}

ALLOWED_MODULES = {"math", "collections", "itertools", "string", "re", "datetime", "typing", "functools"}

def _safe_import(name, globals=None, locals=None, fromlist=(), level=0):
    if name in ALLOWED_MODULES:
        return __import__(name, globals, locals, fromlist, level)
    raise ImportError(f"Import of module '{name}' is not allowed in this sandbox.")

SAFE_BUILTINS["__import__"] = _safe_import


def _run_code(code: str, tests: str, queue: mp.Queue) -> None:
    try:
        env = {"__builtins__": SAFE_BUILTINS}
        exec(code, env, env)
        exec(tests, env, env)
        queue.put((True, "passed"))
    except Exception as e:
        queue.put((False, str(e)))


def pass_at_1(code: str, tests: str, timeout_s: float = 3.0) -> Tuple[float, str]:
    """
    Executes code + tests in a separate process with a timeout.
    Returns: (score, error_message)
    """
    queue: mp.Queue = mp.Queue()
    proc = mp.Process(target=_run_code, args=(code, tests, queue))
    proc.start()
    proc.join(timeout_s)

    if proc.is_alive():
        proc.terminate()
        return 0.0, "timeout"

    if queue.empty():
        return 0.0, "no result"

    ok, msg = queue.get()
    return (1.0, msg) if ok else (0.0, msg)


def evaluate_attempts(codes: List[str], tests: str, timeout_s: float = 3.0) -> List[Tuple[float, str]]:
    return [pass_at_1(code, tests, timeout_s) for code in codes]


def pass_at_k(codes: List[str], tests: str, k: int, timeout_s: float = 3.0) -> Tuple[float, List[Tuple[float, str]]]:
    attempts = evaluate_attempts(codes[: max(1, k)], tests, timeout_s)
    passed = any(score >= 1.0 for score, _ in attempts)
    return (1.0 if passed else 0.0), attempts
