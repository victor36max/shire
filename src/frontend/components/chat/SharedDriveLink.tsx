import type { AnchorHTMLAttributes, MouseEvent } from "react";
import { Link } from "react-router-dom";
import type { Element } from "hast";
import { useProjectLayout } from "../../providers/ProjectLayoutProvider";

interface SharedDriveLinkProps extends AnchorHTMLAttributes<HTMLAnchorElement> {
  projectName: string;
  node?: Element;
}

export function SharedDriveLink({
  href,
  children,
  projectName,
  node: _,
  ...rest
}: SharedDriveLinkProps) {
  const { setPanelFilePath } = useProjectLayout();

  if (href?.startsWith("/shared/")) {
    const filePath = href.slice("/shared".length);
    const to = `/projects/${projectName}/shared?file=${encodeURIComponent(filePath)}`;

    const handleClick = (e: MouseEvent<HTMLAnchorElement>) => {
      // Cmd/Ctrl+click or middle-click: let the browser open a new tab naturally
      if (e.metaKey || e.ctrlKey || e.button === 1) return;

      e.preventDefault();
      setPanelFilePath(filePath);
    };

    return (
      <Link to={to} className="text-primary underline" onClick={handleClick} {...rest}>
        {children}
      </Link>
    );
  }

  return (
    <a href={href} target="_blank" rel="noopener noreferrer" {...rest}>
      {children}
    </a>
  );
}
