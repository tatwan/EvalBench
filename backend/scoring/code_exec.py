import multiprocessing as mp
from typing import Tuple


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
}


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
