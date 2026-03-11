import math
import numpy as np
from scipy import stats
from typing import List, Tuple


def wilson_confidence_interval(successes: int, trials: int, confidence: float = 0.95) -> Tuple[float, float, float, float]:
    """
    Wilson score interval for binomial proportion.
    Returns: (mean, lower, upper, margin_of_error)
    """
    if trials <= 0:
        return 0.0, 0.0, 0.0, 0.0

    z = stats.norm.ppf(1 - (1 - confidence) / 2)
    phat = successes / trials
    denom = 1 + (z ** 2) / trials
    center = (phat + (z ** 2) / (2 * trials)) / denom
    margin = (z / denom) * math.sqrt((phat * (1 - phat) / trials) + (z ** 2) / (4 * trials ** 2))
    lower = max(0.0, center - margin)
    upper = min(1.0, center + margin)
    return float(phat), float(lower), float(upper), float(margin)


def bootstrap_ci(scores: List[float], n_resamples: int = 1000, confidence: float = 0.95) -> Tuple[float, float, float, float]:
    """
    Bootstrap confidence interval for arbitrary metric distributions.
    Returns: (mean, lower, upper, margin_of_error)
    """
    if not scores:
        return 0.0, 0.0, 0.0, 0.0

    rng = np.random.default_rng()
    samples = np.array(scores)
    means = []
    for _ in range(n_resamples):
        resample = rng.choice(samples, size=len(samples), replace=True)
        means.append(float(np.mean(resample)))

    lower_q = (1 - confidence) / 2
    upper_q = 1 - lower_q
    lower = float(np.quantile(means, lower_q))
    upper = float(np.quantile(means, upper_q))
    mean = float(np.mean(samples))
    moe = max(mean - lower, upper - mean)
    return mean, lower, upper, float(moe)


def mcnemar_test(results_a: List[int], results_b: List[int]) -> Tuple[float, float, int, int]:
    """
    McNemar test (exact binomial) for paired binary outcomes.
    Returns: (p_value, chi2_stat, n01, n10)
    """
    if len(results_a) != len(results_b) or not results_a:
        return 1.0, 0.0, 0, 0

    n01 = 0  # A wrong, B right
    n10 = 0  # A right, B wrong
    for a, b in zip(results_a, results_b):
        if a == 0 and b == 1:
            n01 += 1
        elif a == 1 and b == 0:
            n10 += 1

    n = n01 + n10
    if n == 0:
        return 1.0, 0.0, n01, n10

    # Exact binomial test on discordant pairs
    p_value = stats.binomtest(min(n01, n10), n=n, p=0.5).pvalue
    chi2_stat = (abs(n01 - n10) - 1) ** 2 / n  # continuity correction
    return float(p_value), float(chi2_stat), n01, n10


def cohens_h(p1: float, p2: float) -> float:
    """Effect size for proportions."""
    p1 = min(max(p1, 0.0), 1.0)
    p2 = min(max(p2, 0.0), 1.0)
    return float(2 * math.asin(math.sqrt(p1)) - 2 * math.asin(math.sqrt(p2)))

def calculate_confidence_interval(scores: List[float], confidence: float = 0.95) -> Tuple[float, float, float, float]:
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

    # If binary outcomes, use Wilson CI
    if all(s in (0, 1) for s in scores):
        successes = int(sum(scores))
        return wilson_confidence_interval(successes, n, confidence)
        
    se = stats.sem(scores)
    # T-distribution multiplier for the given confidence level and degrees of freedom
    h = se * stats.t.ppf((1 + confidence) / 2., n - 1)
    
    return float(mean), float(mean - h), float(mean + h), float(h)
