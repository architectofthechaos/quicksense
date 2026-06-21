"use client";
import { useEffect, useRef, useState } from "react";
import { EditorState, type Extension } from "@codemirror/state";
import { EditorView, keymap, lineNumbers, highlightActiveLine, highlightActiveLineGutter } from "@codemirror/view";
import { defaultKeymap, history, historyKeymap, indentWithTab } from "@codemirror/commands";
import { python } from "@codemirror/lang-python";
import {
  syntaxHighlighting,
  HighlightStyle,
  indentOnInput,
  bracketMatching,
  foldGutter,
} from "@codemirror/language";
import { tags as t } from "@lezer/highlight";

// Python code editor (CodeMirror 6). Bundled via npm — no CDN — which is why it's
// preferred over Monaco for an air-gapped build. If CodeMirror fails to mount
// (or `forceTextarea` is set), it degrades to a styled monospace textarea so the
// editor still works and the build still passes.

// Theme + syntax colors derive from the design tokens so the editor matches the
// console in both light and dark. CodeMirror needs concrete colors, so we read
// them off CSS variables.
const cmTheme = EditorView.theme({
  "&": { backgroundColor: "transparent", color: "var(--text)", fontSize: "13px" },
  ".cm-content": {
    fontFamily: "var(--font-jetbrains-mono, ui-monospace, SFMono-Regular, Menlo, monospace)",
    padding: "10px 0",
    caretColor: "var(--primary)",
  },
  ".cm-gutters": { backgroundColor: "transparent", color: "var(--text-faint)", border: "none" },
  ".cm-activeLine": { backgroundColor: "color-mix(in srgb, var(--primary) 6%, transparent)" },
  ".cm-activeLineGutter": { backgroundColor: "transparent", color: "var(--text-muted)" },
  ".cm-cursor, .cm-dropCursor": { borderLeftColor: "var(--primary)" },
  "&.cm-focused .cm-selectionBackground, .cm-selectionBackground, ::selection": {
    backgroundColor: "color-mix(in srgb, var(--primary) 22%, transparent)",
  },
  ".cm-matchingBracket": {
    backgroundColor: "color-mix(in srgb, var(--primary) 18%, transparent)",
    outline: "1px solid color-mix(in srgb, var(--primary) 40%, transparent)",
  },
  ".cm-scroller": { fontFamily: "inherit", lineHeight: "1.55" },
});

const highlight = HighlightStyle.define([
  { tag: [t.keyword, t.controlKeyword, t.operatorKeyword], color: "var(--primary)" },
  { tag: [t.string, t.special(t.string)], color: "var(--success)" },
  { tag: [t.comment, t.lineComment, t.blockComment], color: "var(--text-faint)", fontStyle: "italic" },
  { tag: [t.number, t.bool, t.null], color: "var(--warning)" },
  { tag: [t.function(t.variableName), t.function(t.propertyName)], color: "var(--text)" },
  { tag: [t.definitionKeyword, t.className, t.typeName], color: "var(--primary-strong)" },
  { tag: t.propertyName, color: "var(--text-muted)" },
]);

function baseExtensions(onChange: (v: string) => void): Extension[] {
  return [
    lineNumbers(),
    foldGutter(),
    history(),
    indentOnInput(),
    bracketMatching(),
    highlightActiveLine(),
    highlightActiveLineGutter(),
    python(),
    syntaxHighlighting(highlight),
    cmTheme,
    keymap.of([...defaultKeymap, ...historyKeymap, indentWithTab]),
    EditorView.lineWrapping,
    EditorView.updateListener.of((u) => {
      if (u.docChanged) onChange(u.state.doc.toString());
    }),
  ];
}

export function CodeEditor({
  value,
  onChange,
  forceTextarea = false,
  ariaLabel = "Code cell",
  readOnly = false,
}: {
  value: string;
  onChange: (v: string) => void;
  forceTextarea?: boolean;
  ariaLabel?: string;
  readOnly?: boolean;
}) {
  const hostRef = useRef<HTMLDivElement | null>(null);
  const viewRef = useRef<EditorView | null>(null);
  const onChangeRef = useRef(onChange);
  onChangeRef.current = onChange;
  // Start in fallback only when explicitly forced; flip to fallback if mount fails.
  const [fallback, setFallback] = useState(forceTextarea);

  useEffect(() => {
    if (forceTextarea) return;
    const host = hostRef.current;
    if (!host) return;
    try {
      const view = new EditorView({
        state: EditorState.create({
          doc: value,
          extensions: [
            ...baseExtensions((v) => onChangeRef.current(v)),
            EditorView.editable.of(!readOnly),
            EditorState.readOnly.of(readOnly),
          ],
        }),
        parent: host,
      });
      viewRef.current = view;
      return () => {
        view.destroy();
        viewRef.current = null;
      };
    } catch {
      // CodeMirror unavailable (e.g. an environment without DOM layout) — degrade.
      setFallback(true);
    }
    // Mount once; external value changes are reconciled in the effect below.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [forceTextarea, readOnly]);

  // Reconcile external value changes (e.g. a restored revision) into the live
  // doc without clobbering in-progress edits.
  useEffect(() => {
    const view = viewRef.current;
    if (!view) return;
    const current = view.state.doc.toString();
    if (current !== value) {
      view.dispatch({ changes: { from: 0, to: current.length, insert: value } });
    }
  }, [value]);

  if (fallback) {
    return (
      <textarea
        aria-label={ariaLabel}
        value={value}
        readOnly={readOnly}
        spellCheck={false}
        onChange={(e) => onChange(e.target.value)}
        rows={Math.max(3, value.split("\n").length)}
        className="focus-ring block w-full resize-y rounded-md border border-border bg-surface-2 px-3 py-2.5 font-mono text-[13px] leading-relaxed text-foreground placeholder:text-faint"
        placeholder="# Python"
      />
    );
  }

  return (
    <div
      ref={hostRef}
      role="group"
      aria-label={ariaLabel}
      className="overflow-hidden rounded-md border border-border bg-surface-2 focus-within:ring-2 focus-within:ring-ring focus-within:ring-offset-2 focus-within:ring-offset-[var(--bg)]"
    />
  );
}
