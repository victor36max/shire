import type { AnchorHTMLAttributes } from "react";
import { Link } from "react-router-dom";
import type { Element } from "hast";

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
  if (href?.startsWith("/shared/")) {
    const filePath = href.slice("/shared".length);
    const to = `/projects/${projectName}/shared?file=${encodeURIComponent(filePath)}`;
    return (
      <Link to={to} className="text-primary underline" {...rest}>
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
