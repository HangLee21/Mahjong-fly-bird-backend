from __future__ import annotations

from typing import Any


def configure_torch_runtime(config: dict[str, Any] | None = None) -> dict[str, Any]:
    """Apply CUDA/PyTorch runtime knobs before model construction."""

    cfg = config or {}
    try:
        import torch
    except Exception:
        return {"torch_available": False}

    result: dict[str, Any] = {
        "torch_available": True,
        "torch_version": torch.__version__,
        "cuda_available": torch.cuda.is_available(),
        "cuda_version": torch.version.cuda,
    }
    if cfg.get("num_threads") is not None:
        torch.set_num_threads(int(cfg["num_threads"]))
        result["num_threads"] = torch.get_num_threads()
    if cfg.get("matmul_precision"):
        torch.set_float32_matmul_precision(str(cfg["matmul_precision"]))
        result["matmul_precision"] = str(cfg["matmul_precision"])

    if torch.cuda.is_available():
        device_index = int(cfg.get("device_index", 0))
        allow_tf32 = bool(cfg.get("allow_tf32", True))
        torch.backends.cuda.matmul.allow_tf32 = allow_tf32
        if hasattr(torch.backends, "cudnn"):
            torch.backends.cudnn.allow_tf32 = allow_tf32
            torch.backends.cudnn.benchmark = bool(cfg.get("cudnn_benchmark", True))
        if cfg.get("empty_cache_on_start", False):
            torch.cuda.empty_cache()
        if cfg.get("memory_fraction") is not None:
            torch.cuda.set_per_process_memory_fraction(float(cfg["memory_fraction"]), device_index)
        props = torch.cuda.get_device_properties(device_index)
        result.update(
            {
                "device_index": device_index,
                "device_name": props.name,
                "total_memory_mib": props.total_memory // (1024 * 1024),
                "allow_tf32": allow_tf32,
                "cudnn_benchmark": bool(getattr(torch.backends.cudnn, "benchmark", False)),
                "memory_fraction": cfg.get("memory_fraction"),
            }
        )
    return result

