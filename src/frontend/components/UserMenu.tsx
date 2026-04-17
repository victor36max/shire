import { CircleUser, LogOut } from "lucide-react";
import { useNavigate } from "react-router-dom";
import { Button } from "./ui/button";
import { Popover, PopoverContent, PopoverTrigger } from "./ui/popover";
import { Separator } from "./ui/separator";
import { useAppConfig, useLogout } from "../hooks/auth";
import { useUsername } from "../stores/auth";

interface UserMenuProps {
  variant?: "icon" | "sidebar";
}

export default function UserMenu({ variant = "icon" }: UserMenuProps) {
  const { data: config } = useAppConfig();
  const username = useUsername();
  const logout = useLogout();
  const navigate = useNavigate();

  if (!config?.authEnabled || !username) return null;

  const trigger =
    variant === "sidebar" ? (
      <Button
        variant="ghost"
        size="sm"
        className="w-full justify-start gap-2 text-muted-foreground"
        aria-label="User menu"
      >
        <CircleUser className="h-4 w-4" />
        {username}
      </Button>
    ) : (
      <Button variant="ghost" size="icon" aria-label="User menu">
        <CircleUser className="h-5 w-5" />
      </Button>
    );

  return (
    <Popover>
      <PopoverTrigger asChild>{trigger}</PopoverTrigger>
      <PopoverContent align="end" className="w-48 p-2">
        <div className="px-2 py-1.5 text-sm font-medium truncate">{username}</div>
        <Separator className="my-1" />
        <Button
          variant="ghost"
          size="sm"
          className="w-full justify-start gap-2"
          onClick={() => logout.mutate(undefined, { onSuccess: () => navigate("/login") })}
          disabled={logout.isPending}
        >
          <LogOut className="h-4 w-4" />
          Log out
        </Button>
      </PopoverContent>
    </Popover>
  );
}
