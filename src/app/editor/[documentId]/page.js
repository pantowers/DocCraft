import EditorWorkspace from "@/components/editor/EditorWorkspace";

export default async function EditorPage({ params }) {
  const { documentId } = await params;
  return <EditorWorkspace documentId={documentId} />;
}
