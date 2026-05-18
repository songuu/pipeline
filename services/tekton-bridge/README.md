# tekton-bridge

Go service that fronts a Tekton-on-Kubernetes execution kernel and exposes a
small HTTP API consumed by the Nest control plane.

## API

```
GET  /healthz
GET  /v1/capabilities                discover backend/k8s/tekton/runtime capability
POST /v1/preflight                   validate namespace, CRDs, PVC, Secret, params
POST /v1/runs                       create a run; body = StartRunInput
GET  /v1/runs/{runId}               run status
POST /v1/runs/{runId}/cancel        cancel
GET  /v1/runs/{runId}/events        SSE stream of run events
GET  /v1/runs/{runId}/taskruns/{taskRunName}
GET  /v1/runs/{runId}/taskruns/{taskRunName}/logs?step={stepName}
```

Schemas are mirrored manually from `packages/shared/src/index.ts` (see
`internal/domain/run.go`).

## Backends

Two backends share the same `backend.Backend` interface.

| Backend | Build tag | Requires k8s | Use case |
|---|---|---|---|
| `SimulatedBackend` | none | no | local dev, integration tests |
| `TektonBackend` (default with `tekton` tag) | `tekton` | yes | real cluster with tektoncd/pipeline |

Default build:
```
go mod tidy
go build ./...
go run ./cmd/server
```

Tekton build (cluster required):
```
go build -tags tekton ./...
TEKTON_BRIDGE_NAMESPACE=ci go run -tags tekton ./cmd/server
```

The real backend uses Kubernetes dynamic client APIs against Tekton CRDs:

- `POST /v1/runs` creates a real `tekton.dev/v1 PipelineRun`.
- `GET /v1/runs/{runId}` reads the PipelineRun condition and TaskRuns labelled
  with `tekton.dev/pipelineRun={name}`.
- `POST /v1/runs/{runId}/cancel` patches `spec.status=PipelineRunCancelled`.
- `GET /v1/runs/{runId}/events` emits a current status/stage snapshot, then
  watches PipelineRun, TaskRun, Pod, and Kubernetes Event changes through the
  Kubernetes watch API.
- `GET /v1/runs/{runId}/taskruns/{taskRunName}` returns the real TaskRun
  status, step state, results, `status.podName`, and related Kubernetes events.
- `GET /v1/runs/{runId}/taskruns/{taskRunName}/logs?step={stepName}` reads
  `pods/log` for the matching Tekton step container, trying `step-{name}` first.

If `TEKTON_PIPELINE_REF` is set, the backend creates a PipelineRun referencing
that existing cluster Pipeline and passes platform params. If it is not set,
the backend creates a self-contained inline `pipelineSpec` so a cluster with
Tekton installed can still run a smoke PipelineRun.

Build and image push params come from the Nest pipeline definition, not from a
hard-coded registry. The API passes `PACKAGE_BUILD_SCRIPT`,
`PACKAGE_OUTPUT_PATHS`, `REGISTRY_PROVIDER`, `IMAGE_REF`, `IMAGE_REGISTRY`,
`IMAGE_REPOSITORY`, `DOCKERFILE_PATH`, `BUILD_CONTEXT`, and
`REGISTRY_SERVICE_CONNECTION` to the bridge. In inline mode the real flow is:
`git clone/checkout` -> `pnpm/npm/yarn run <PACKAGE_BUILD_SCRIPT>` ->
`docker build` -> `docker push`. Set `TEKTON_SOURCE_PVC` for the shared checkout
workspace. The docker config secret is resolved from run param
`REGISTRY_DOCKER_SECRET` first, then `TEKTON_DOCKER_SECRET`, and is mounted at
`/root/.docker` for authenticated registries. The Secret must be a
docker-registry Secret (`kubernetes.io/dockerconfigjson` or
`kubernetes.io/dockercfg`). The bridge validates this before creating the
PipelineRun and returns the exact `kubectl create secret docker-registry ...`
command when it is missing. The default ACR target is
`crpi-yjy3pqx1wqed2s2s.cn-hangzhou.personal.cr.aliyuncs.com/company_sy/deploy`.
For real runs keep the Nest API on `EXECUTOR=tekton`; simulated fallback must
stay disabled. The Nest API checks `/healthz` before creating a run and rejects
the request if the bridge reports `backend=simulated`.

Inline Docker builds use a `docker:27-dind` sidecar plus `docker:27-cli` steps.
The Tekton namespace must allow privileged sidecars; otherwise the Docker build
task fails loudly instead of producing a fake artifact.

## Configuration

| Env | Default | Purpose |
|---|---|---|
| `TEKTON_BRIDGE_ADDR` | `:5050` | listen address |
| `TEKTON_BRIDGE_BACKEND` | `tekton` with `tekton` build tag; `simulated` otherwise | Set to `simulated` only for explicit fake local demos |
| `TEKTON_BRIDGE_NAMESPACE` | `default` | k8s namespace (Tekton mode) |
| `TEKTON_ALLOW_SIMULATED_FALLBACK` | `false` | Nest-side opt-in fallback; keep disabled for real package/image output |
| `TEKTON_BRIDGE_KUBECONFIG` | unset | kubeconfig path; falls back to `KUBECONFIG`, `~/.kube/config`, or in-cluster config |
| `TEKTON_PIPELINE_REF` | unset | existing cluster Pipeline to run instead of inline generated `pipelineSpec` |
| `TEKTON_TASK_IMAGE` | `alpine:3.20` | image used by generated inline tasks |
| `TEKTON_NODE_BUILD_IMAGE` | `node:20-alpine` | image used by the package.json build step; can point to an internal registry mirror |
| `TEKTON_DOCKER_CLI_IMAGE` | `docker:27-cli` | image used by docker build/push steps |
| `TEKTON_DOCKER_DIND_IMAGE` | `docker:27-dind` | sidecar image providing the Docker daemon |
| `TEKTON_SERVICE_ACCOUNT` | unset | service account name checked by preflight; unset means namespace default SA is used |
| `TEKTON_BUILD_STRATEGY` | `dind` | build strategy exposed by capabilities; current inline implementation uses DinD |
| `TEKTON_STAGE_SLEEP_SECONDS` | `2` | per-stage sleep for generated inline tasks |
| `TEKTON_SOURCE_PVC` | unset | workspace binding for `source-ws`; required by the inline source checkout + image build path |
| `TEKTON_CACHE_PVC` | unset | optional workspace binding for `cache-ws` |
| `TEKTON_DOCKER_SECRET` | unset | fallback secret workspace for `docker-config`; run param `REGISTRY_DOCKER_SECRET` wins |
| `TEKTON_KUBECONFIG_SECRET` | unset | optional secret workspace for `kubeconfig` |

## Smoke test

```
curl -s http://127.0.0.1:5050/healthz
curl -s -X POST http://127.0.0.1:5050/v1/runs -H 'content-type: application/json' \
  -d '{"pipelineRunId":"smoke-1","pipelineName":"smoke","applicationId":"demo","environment":"dev","stages":["source","test","build"]}'
curl -sN http://127.0.0.1:5050/v1/runs/smoke-1/events &
sleep 5
curl -s http://127.0.0.1:5050/v1/runs/smoke-1
```
