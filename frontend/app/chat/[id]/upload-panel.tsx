"use client";

import { useDataset } from "./dataset-context";
import { DropZone } from "./drop-zone";
import { NotesEditor } from "./notes-editor";
import { TablesList } from "./tables-list";

/**
 * The Dataset sidebar's content: add data (a drop strip with the sample link under it), Notes, Tables.
 * The Data section shows only once the Chat has Tables: before that, the main pane holds the (only) drop zone.
 */
export function UploadPanel({ chatId }: { chatId: string }) {
  const { reports, profile, notes, setNotes, processing, hasTables } = useDataset();

  return (
    <section className="mt-6 flex flex-col gap-6">
      {hasTables && (
        <div className="flex flex-col gap-2">
          <h2 className="text-sm font-semibold">Data</h2>
          <DropZone size="strip" />
        </div>
      )}
      <NotesEditor chatId={chatId} notes={notes} setNotes={setNotes} disabled={processing !== null} />
      <TablesList reports={reports} profile={profile} />
    </section>
  );
}
