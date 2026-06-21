"use client";
import { useState, type KeyboardEvent } from "react";
import { ChevronRight, Folder, FolderOpen, FileCode } from "lucide-react";
import type { WorkspaceNode } from "@/lib/types";

// WorkspaceTree renders a fully-built folder/notebook tree (the workspace pane).
// Unlike the catalog Tree it is not lazy — the whole tree is derived up-front
// from the flat notebook list — and folders start expanded so a user sees their
// notebooks immediately. Notebook leaves are selectable; folders toggle.
export function WorkspaceTree({
  nodes,
  selectedId,
  onSelectNotebook,
}: {
  nodes: WorkspaceNode[];
  selectedId: string | null;
  onSelectNotebook: (notebookId: string) => void;
}) {
  return (
    <ul role="tree" aria-label="Workspace" className="select-none py-1 text-sm">
      {nodes.map((n) => (
        <Branch key={n.id} node={n} depth={0} selectedId={selectedId} onSelectNotebook={onSelectNotebook} />
      ))}
    </ul>
  );
}

function Branch({
  node,
  depth,
  selectedId,
  onSelectNotebook,
}: {
  node: WorkspaceNode;
  depth: number;
  selectedId: string | null;
  onSelectNotebook: (notebookId: string) => void;
}) {
  const [expanded, setExpanded] = useState(true);
  const isFolder = node.kind === "folder";
  const selected = !isFolder && node.notebookId != null && node.notebookId === selectedId;
  const indentPx = 10 + depth * 16;

  function activate() {
    if (isFolder) setExpanded((e) => !e);
    else if (node.notebookId) onSelectNotebook(node.notebookId);
  }

  function onKeyDown(e: KeyboardEvent) {
    switch (e.key) {
      case "ArrowRight":
        if (isFolder && !expanded) {
          e.preventDefault();
          setExpanded(true);
        }
        break;
      case "ArrowLeft":
        if (isFolder && expanded) {
          e.preventDefault();
          setExpanded(false);
        }
        break;
      case "Enter":
      case " ":
        e.preventDefault();
        activate();
        break;
    }
  }

  const Icon = isFolder ? (expanded ? FolderOpen : Folder) : FileCode;

  return (
    <li role="none">
      <div
        role="treeitem"
        aria-expanded={isFolder ? expanded : undefined}
        aria-selected={selected}
        aria-label={node.label}
        tabIndex={0}
        onClick={activate}
        onKeyDown={onKeyDown}
        style={{ paddingLeft: indentPx }}
        className={`focus-ring group flex cursor-pointer items-center gap-1.5 rounded-md py-1.5 pr-2 transition-colors ${
          selected ? "bg-primary-tint font-medium text-primary" : "text-foreground hover:bg-muted"
        }`}
      >
        <span className="flex h-4 w-4 shrink-0 items-center justify-center text-muted-foreground">
          {isFolder ? (
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

      {isFolder && expanded && node.children && node.children.length > 0 && (
        <ul role="group">
          {node.children.map((c) => (
            <Branch key={c.id} node={c} depth={depth + 1} selectedId={selectedId} onSelectNotebook={onSelectNotebook} />
          ))}
        </ul>
      )}
    </li>
  );
}
