import { Badge } from "@tokophi/ui/badge";

export function BlogStatusBadge({ published }: { published: boolean }) {
  if (published) {
    return (
      <Badge className="bg-emerald-500/10 text-emerald-600 dark:bg-emerald-500/15 dark:text-emerald-400">
        Terbit
      </Badge>
    );
  }
  return <Badge className="bg-muted text-muted-foreground">Draft</Badge>;
}
