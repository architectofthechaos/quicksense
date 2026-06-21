"use client";
import { useCallback, useRef, useState, type KeyboardEvent } from "react";
import { ChevronRight, Database, Folder, FolderOpen, Table2, type LucideIcon } from "lucide-react";

// A node kind drives the leading icon and a11y semantics. Kinds map to the
// catalog hierarchy but the component itself is generic.
export type TreeNodeKind = "catalog" | "namespace" | "table";

export type TreeNode = {
  id: string;
  label: string;
  kind: TreeNodeKind;
  // hasChildren=false renders a selectable leaf (no expander). true renders an
  // expandable row whose children are fetched lazily via loadChildren.
  hasChildren: boolean;
};

const KIND_ICON: Record<TreeNodeKind, { collapsed: LucideIcon; expanded: LucideIcon }> = {
  catalog: { collapsed: Database, expanded: Database },
  namespace: { collapsed: Folder, expanded: FolderOpen },
  table: { collapsed: Table2, expanded: Table2 },
};

// Per-node lazy-load state, keyed by node id. Cached so collapse/re-expand does
// not refetch.
type LoadState = {
  status: "idle" | "loading" | "loaded" | "error";
  children: TreeNode[];
};

export function Tree({
  nodes,
  loadChildren,
  onSelect,
  selectedId = null,
}: {
  nodes: TreeNode[];
  loadChildren: (node: TreeNode) => Promise<TreeNode[]>;
  onSelect: (node: TreeNode) => void;
  selectedId?: string | null;
}) {
  return (
    <ul role="tree" aria-label="Catalog explorer" className="select-none py-1 text-sm">
      {nodes.map((n) => (
        <TreeBranch
          key={n.id}
          node={n}
          depth={0}
          loadChildren={loadChildren}
          onSelect={onSelect}
          selectedId={selectedId}
        />
      ))}
    </ul>
  );
}

function TreeBranch({
  node,
  depth,
  loadChildren,
  onSelect,
  selectedId,
}: {
  node: TreeNode;
  depth: number;
  loadChildren: (node: TreeNode) => Promise<TreeNode[]>;
  onSelect: (node: TreeNode) => void;
  selectedId: string | null;
}) {
  const [expanded, setExpanded] = useState(false);
  const [state, setState] = useState<LoadState>({ status: "idle", children: [] });
  const rowRef = useRef<HTMLDivElement | null>(null);

  const selected = node.id === selectedId;
  const icons = KIND_ICON[node.kind];
  const Icon = expanded ? icons.expanded : icons.collapsed;

  const ensureLoaded = useCallback(async () => {
    // Load once; cache thereafter (re-expanding never refetches).
    if (state.status === "loaded" || state.status === "loading") return;
    setState({ status: "loading", children: [] });
    try {
      const children = await loadChildren(node);
      setState({ status: "loaded", children });
    } catch {
      setState({ status: "error", children: [] });
    }
  }, [loadChildren, node, state.status]);

  const expand = useCallback(() => {
    setExpanded(true);
    void ensureLoaded();
  }, [ensureLoaded]);

  function toggle() {
    if (!node.hasChildren) {
      onSelect(node);
      return;
    }
    if (expanded) setExpanded(false);
    else expand();
  }

  function onKeyDown(e: KeyboardEvent) {
    switch (e.key) {
      case "ArrowRight":
        if (node.hasChildren && !expanded) {
          e.preventDefault();
          expand();
        }
        break;
      case "ArrowLeft":
        if (node.hasChildren && expanded) {
          e.preventDefault();
          setExpanded(false);
        }
        break;
      case "Enter":
      case " ":
        e.preventDefault();
        toggle();
        break;
    }
  }

  // Indent each level; the chevron column keeps leaves aligned with parents.
  const indentPx = 10 + depth * 16;

  return (
    <li role="none">
      <div
        ref={rowRef}
        role="treeitem"
        aria-expanded={node.hasChildren ? expanded : undefined}
        aria-selected={selected}
        aria-label={node.label}
        tabIndex={0}
        onClick={toggle}
        onKeyDown={onKeyDown}
        style={{ paddingLeft: indentPx }}
        className={`focus-ring group flex cursor-pointer items-center gap-1.5 rounded-md py-1.5 pr-2 transition-colors ${
          selected
            ? "bg-primary-tint font-medium text-primary"
            : "text-foreground hover:bg-muted"
        }`}
      >
        <span className="flex h-4 w-4 shrink-0 items-center justify-center text-muted-foreground">
          {node.hasChildren ? (
            <ChevronRight
              className={`h-3.5 w-3.5 transition-transform duration-150 ${expanded ? "rotate-90" : ""}`}
              aria-hidden
            />
          ) : null}
        </span>
        <Icon
          className={`h-4 w-4 shrink-0 ${selected ? "text-primary" : "text-muted-foreground group-hover:text-foreground"}`}
          strokeWidth={2}
          aria-hidden
        />
        <span className="truncate">{node.label}</span>
      </div>

      {node.hasChildren && expanded && (
        <ul role="group">
          {state.status === "loading" && (
            <li role="none" className="py-1 text-xs text-muted-foreground" style={{ paddingLeft: indentPx + 30 }}>
              Loading…
            </li>
          )}
          {state.status === "error" && (
            <li role="none" className="py-1 text-xs text-error" style={{ paddingLeft: indentPx + 30 }}>
              Failed to load
            </li>
          )}
          {state.status === "loaded" && state.children.length === 0 && (
            <li role="none" className="py-1 text-xs text-faint" style={{ paddingLeft: indentPx + 30 }}>
              No items
            </li>
          )}
          {state.children.map((c) => (
            <TreeBranch
              key={c.id}
              node={c}
              depth={depth + 1}
              loadChildren={loadChildren}
              onSelect={onSelect}
              selectedId={selectedId}
            />
          ))}
        </ul>
      )}
    </li>
  );
}
