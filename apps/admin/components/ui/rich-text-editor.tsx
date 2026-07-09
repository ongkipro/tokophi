"use client";
import * as React from "react";
import { useEditor, EditorContent, type Editor } from "@tiptap/react";
import StarterKit from "@tiptap/starter-kit";
import Link from "@tiptap/extension-link";
import Placeholder from "@tiptap/extension-placeholder";
import {
  Bold, Italic, Strikethrough, Heading2, Heading3, List, ListOrdered,
  Quote, Link as LinkIcon, Undo2, Redo2,
} from "lucide-react";
import { cn } from "@/lib/utils";

// Free WYSIWYG editor (Tiptap, MIT). Value/onChange are HTML strings stored in the `body` column.
export function RichTextEditor({
  value,
  onChange,
  placeholder,
  disabled,
  className,
}: {
  value: string;
  onChange: (html: string) => void;
  placeholder?: string;
  disabled?: boolean;
  className?: string;
}) {
  const editor = useEditor({
    editable: !disabled,
    immediatelyRender: false, // avoid Next SSR hydration mismatch
    extensions: [
      StarterKit.configure({ heading: { levels: [2, 3] } }),
      Link.configure({ openOnClick: false, HTMLAttributes: { class: "text-primary underline" } }),
      Placeholder.configure({ placeholder: placeholder ?? "Tulis konten di sini…" }),
    ],
    content: value || "",
    onUpdate: ({ editor }) => onChange(editor.getHTML()),
    editorProps: {
      attributes: {
        class: "tokophi-rte min-h-[220px] w-full px-3 py-2 text-sm focus:outline-none",
      },
    },
  });

  // sync when the value prop changes externally (e.g. async data load) without clobbering typing
  React.useEffect(() => {
    if (editor && value !== editor.getHTML()) editor.commands.setContent(value || "", { emitUpdate: false });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [value, editor]);

  if (!editor) return null;

  return (
    <div className={cn("overflow-hidden rounded-md border bg-background", disabled && "opacity-60", className)}>
      <Toolbar editor={editor} disabled={disabled} />
      <EditorContent editor={editor} />
      {/* minimal content styling (no typography plugin needed) */}
      <style>{`
        .tokophi-rte h2 { font-size: 1.25rem; font-weight: 600; margin: .75rem 0 .35rem; }
        .tokophi-rte h3 { font-size: 1.1rem; font-weight: 600; margin: .6rem 0 .3rem; }
        .tokophi-rte p { margin: .35rem 0; }
        .tokophi-rte ul { list-style: disc; padding-left: 1.25rem; margin: .35rem 0; }
        .tokophi-rte ol { list-style: decimal; padding-left: 1.25rem; margin: .35rem 0; }
        .tokophi-rte blockquote { border-left: 3px solid var(--border); padding-left: .75rem; color: var(--muted-foreground); margin: .5rem 0; }
        .tokophi-rte a { color: var(--primary); text-decoration: underline; }
        .tokophi-rte p.is-editor-empty:first-child::before {
          content: attr(data-placeholder); color: var(--muted-foreground); float: left; height: 0; pointer-events: none;
        }
      `}</style>
    </div>
  );
}

function Btn({
  onClick, active, disabled, title, children,
}: {
  onClick: () => void; active?: boolean; disabled?: boolean; title: string; children: React.ReactNode;
}) {
  return (
    <button
      type="button"
      title={title}
      onClick={onClick}
      disabled={disabled}
      className={cn(
        "inline-flex size-8 items-center justify-center rounded text-muted-foreground transition-colors hover:bg-muted hover:text-foreground disabled:opacity-40",
        active && "bg-muted text-foreground",
      )}
    >
      {children}
    </button>
  );
}

function Toolbar({ editor, disabled }: { editor: Editor; disabled?: boolean }) {
  const setLink = () => {
    const prev = editor.getAttributes("link").href as string | undefined;
    const url = window.prompt("URL tautan:", prev ?? "https://");
    if (url === null) return;
    if (url === "") editor.chain().focus().unsetLink().run();
    else editor.chain().focus().extendMarkRange("link").setLink({ href: url }).run();
  };
  return (
    <div className="flex flex-wrap items-center gap-0.5 border-b bg-muted/30 px-1.5 py-1">
      <Btn title="Tebal" active={editor.isActive("bold")} disabled={disabled} onClick={() => editor.chain().focus().toggleBold().run()}><Bold className="size-4" /></Btn>
      <Btn title="Miring" active={editor.isActive("italic")} disabled={disabled} onClick={() => editor.chain().focus().toggleItalic().run()}><Italic className="size-4" /></Btn>
      <Btn title="Coret" active={editor.isActive("strike")} disabled={disabled} onClick={() => editor.chain().focus().toggleStrike().run()}><Strikethrough className="size-4" /></Btn>
      <span className="mx-1 h-5 w-px bg-border" />
      <Btn title="Judul H2" active={editor.isActive("heading", { level: 2 })} disabled={disabled} onClick={() => editor.chain().focus().toggleHeading({ level: 2 }).run()}><Heading2 className="size-4" /></Btn>
      <Btn title="Judul H3" active={editor.isActive("heading", { level: 3 })} disabled={disabled} onClick={() => editor.chain().focus().toggleHeading({ level: 3 }).run()}><Heading3 className="size-4" /></Btn>
      <span className="mx-1 h-5 w-px bg-border" />
      <Btn title="Daftar" active={editor.isActive("bulletList")} disabled={disabled} onClick={() => editor.chain().focus().toggleBulletList().run()}><List className="size-4" /></Btn>
      <Btn title="Daftar bernomor" active={editor.isActive("orderedList")} disabled={disabled} onClick={() => editor.chain().focus().toggleOrderedList().run()}><ListOrdered className="size-4" /></Btn>
      <Btn title="Kutipan" active={editor.isActive("blockquote")} disabled={disabled} onClick={() => editor.chain().focus().toggleBlockquote().run()}><Quote className="size-4" /></Btn>
      <Btn title="Tautan" active={editor.isActive("link")} disabled={disabled} onClick={setLink}><LinkIcon className="size-4" /></Btn>
      <span className="mx-1 h-5 w-px bg-border" />
      <Btn title="Urungkan" disabled={disabled || !editor.can().undo()} onClick={() => editor.chain().focus().undo().run()}><Undo2 className="size-4" /></Btn>
      <Btn title="Ulangi" disabled={disabled || !editor.can().redo()} onClick={() => editor.chain().focus().redo().run()}><Redo2 className="size-4" /></Btn>
    </div>
  );
}
