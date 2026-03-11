import numpy as np
from scipy import stats
from typing import List, Tuple

def calculate_confidence_interval(scores: List[float], confidence: float = 0.95) -> Tuple[float, float, float]:
    """
    Calculates the mean and the Margin of Error (MoE) for a 95% confidence interval 
    of a given list of scores.
    Returns: (mean, lower_bound, upper_bound, margin_of_error)
    """
    if not scores:
        return 0.0, 0.0, 0.0, 0.0
    
    n = len(scores)
    mean = np.mean(scores)
    
    if n < 2:
        return float(mean), float(mean), float(mean), 0.0
        
    se = stats.sem(scores)
    # T-distribution multiplier for the given confidence level and degrees of freedom
    h = se * stats.t.ppf((1 + confidence) / 2., n - 1)
    
    return float(mean), float(mean - h), float(mean + h), float(h)
