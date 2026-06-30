# bbux-shared

Reusable React + Go building blocks: a floating-panel modal, UI primitives
(Kbd, Tooltip), hooks, list filter/table-setting types, and an in-memory row
filter/sort engine. Public, so any consumer's Docker/CI can install it
anonymously (no token/git auth).

## Layout

```
packages/
  ts/
    ui/      @bbux/ui    — ModalProvider/ModalPanel/useModals + Kbd, Tooltip, cn (+ @bbux/ui/modal.css)
    hooks/   @bbux/hooks — useIsMobile
    types/   @bbux/types — list filter + table-settings types/helpers
  go/
    filters/ github.com/matthewblackburn/bbux-shared/packages/go/filters
             — Operator semantics + in-memory FilterRows / SortRows
```

## Install

```jsonc
// package.json
"@bbux/ui":    "github:matthewblackburn/bbux-shared#path:packages/ts/ui",
"@bbux/hooks": "github:matthewblackburn/bbux-shared#path:packages/ts/hooks",
"@bbux/types": "github:matthewblackburn/bbux-shared#path:packages/ts/types"
```

```bash
go get github.com/matthewblackburn/bbux-shared/packages/go/filters
```

The TS packages ship raw source consumed by the consumer's Vite/esbuild (no build step).
