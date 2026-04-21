# Review Synthesis — 2026-04-12

## Overall verdict
The demo skeleton is directionally correct and the System A / System B split is sound, but it was not yet runnable end-to-end. All three reviewers agreed the biggest issues are implementation and deployment gaps, not architectural contradictions.

## Consensus critical issues
1. Hardcoded `System B` public IP committed in manifests/config/scripts
2. Control plane is a stub and does not create/delete Kubernetes session pods
3. `control-plane` Deployment missing `serviceAccountName: control-plane`
4. `session-pod-template` is modeled as a live Deployment instead of a true template pattern
5. MinIO auth/bucket path is incomplete for real artifact flow
6. Setup flow is incomplete: missing image build/load, missing control-plane/rbac apply, missing automatic `ollama pull`

## Consensus should-fix issues
1. Remove plaintext/default MinIO credentials from repo manifests
2. Pin LiteLLM to a stable version instead of `main-latest`
3. Fix config path mismatch in `entrypoint.sh`
4. Add `SYSTEM_A_IP`/templating instead of hardcoded localhost/public IP assumptions
5. Harden session pod security context before broader exposure
6. Make smoke test verify actual prerequisites, including model availability and bucket existence

## Immediate fix plan
1. Remove committed public IP/default credentials from tracked manifests
2. Add envsubst-based render path in setup scripts
3. Add control-plane ServiceAccount binding
4. Convert session-pod manifest from live Deployment to pod template ConfigMap
5. Apply RBAC/control-plane in setup script
6. Automate ollama model pull and MinIO bucket creation
7. Pin LiteLLM image and align config defaults

## Deferred but required soon
- Implement real Kubernetes client logic in control plane
- Add API auth for control plane
- Add NetworkPolicy / security-group restrictions
- Add build/load scripts for local images and GHCR workflow for two-host setup
