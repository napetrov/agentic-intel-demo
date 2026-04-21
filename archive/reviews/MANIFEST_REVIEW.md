---
review_type: architecture
focus_areas: [kubernetes-manifests, cross-instance-networking, control-plane-design, security, rollout-feasibility]
severity_threshold: medium
files_omitted: []
---

# Review Manifest

## What changed
Initial runnable skeleton for a two-system demo:
- System B: ollama, minio
- System A: litellm, control-plane, session pod template
- session runtime image skeleton
- setup/smoke scripts
- implementation decisions doc

## Files included
- review-bundle.txt — consolidated content for all changed files

## Review focus
Please review for:
- correctness of split System A / System B deployment model
- Kubernetes manifest quality and deployability
- security/config risks in secrets, ports, and service exposure
- feasibility of the next implementation steps
- missing blockers before real deployment

## Acceptance criteria
- [ ] No major architectural contradiction
- [ ] No obvious security/config footguns left uncalled out
- [ ] Next steps are feasible and ordered correctly
