from sentence_transformers import SentenceTransformer, util
import threading

_model = None
_lock = threading.Lock()

def _get_model():
    global _model
    if _model is None:
        with _lock:
            if _model is None:
                _model = SentenceTransformer('paraphrase-MiniLM-L6-v2')
    return _model

def is_available() -> bool:
    try:
        import sentence_transformers
        return True
    except ImportError:
        return False

def compute_similarity(output_text: str, reference_text: str) -> float:
    if not output_text.strip() or not reference_text.strip():
        return 0.0
    model = _get_model()
    emb1 = model.encode(output_text, convert_to_tensor=True)
    emb2 = model.encode(reference_text, convert_to_tensor=True)
    sim = util.cos_sim(emb1, emb2).item()
    return max(0.0, min(1.0, float(sim)))
