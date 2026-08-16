import torch

from experiments.sparse_topk_pixel_attack import apply_sparse_fgsm, topk_spatial_mask


def test_topk_selects_spatial_locations_across_rgb_channels() -> None:
    gradient = torch.zeros((3, 2, 3))
    gradient[:, 0, 1] = torch.tensor([1.0, 2.0, 3.0])
    gradient[:, 1, 2] = torch.tensor([2.0, 2.0, 1.0])

    mask = topk_spatial_mask(gradient, 2)

    assert int(mask.sum()) == 2
    assert mask[0, 1]
    assert mask[1, 2]


def test_sparse_fgsm_changes_only_selected_pixel_locations() -> None:
    image = torch.full((3, 3, 3), 0.5)
    gradient = torch.arange(1, 28, dtype=torch.float32).reshape(3, 3, 3)

    attacked, delta, mask = apply_sparse_fgsm(image, gradient, k=2, epsilon=4 / 255)

    changed_locations = delta.abs().sum(dim=0) > 0
    assert torch.equal(changed_locations, mask)
    assert int(changed_locations.sum()) == 2
    assert torch.equal(attacked[:, ~mask], image[:, ~mask])
