import { Avatar, AvatarFallback } from "@tokophi/ui/avatar";
import { initials } from "../initials";

export function AuthorCell({ name }: { name: string }) {
  return (
    <div className="flex items-center gap-2">
      <Avatar size="sm">
        <AvatarFallback className="text-[10px] font-medium">
          {initials(name)}
        </AvatarFallback>
      </Avatar>
      <span className="truncate text-sm">{name}</span>
    </div>
  );
}
