import threading

_model = None
_lock = threading.Lock()

def _get_model():
    global _model
    if _model is None:
        with _lock:
            if _model is None:
                from detoxify import Detoxify
                _model = Detoxify('original')
    return _model

def is_available() -> bool:
    try:
        import detoxify
        return True
    except ImportError:
        return False

def compute_toxicity(output_text: str) -> float:
    if not output_text.strip():
        return 0.0
    model = _get_model()
    results = model.predict(output_text)
    return float(results.get("toxicity", 0.0))
