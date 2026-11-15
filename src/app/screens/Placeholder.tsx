type PlaceholderProps = {
  title: string;
  /** What will live here and which Linear issue delivers it. */
  detail: string;
};

/** Honest empty state for a screen whose slice has not landed yet. */
export function Placeholder({ title, detail }: PlaceholderProps) {
  return (
    <section className="mx-auto flex max-w-xl flex-col gap-2 px-4 py-12">
      <h1 className="text-xl font-medium">{title}</h1>
      <p className="text-sm text-muted-foreground">{detail}</p>
    </section>
  );
}
