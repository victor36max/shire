import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "./components/ui/select";
import { navigate } from "./lib/navigate";
import type { Project } from "./types";

interface ProjectSwitcherProps {
  projects: Project[];
  currentProjectId: string;
}

export default function ProjectSwitcher({ projects, currentProjectId }: ProjectSwitcherProps) {
  return (
    <Select
      value={currentProjectId}
      onValueChange={(value) => {
        if (value === "__all__") {
          navigate("/");
        } else {
          navigate(`/projects/${value}`);
        }
      }}
    >
      <SelectTrigger className="w-full text-sm">
        <SelectValue placeholder="Select project" />
      </SelectTrigger>
      <SelectContent>
        {projects.map((project) => (
          <SelectItem key={project.id} value={project.id}>
            {project.name}
          </SelectItem>
        ))}
        <SelectItem value="__all__">All Projects</SelectItem>
      </SelectContent>
    </Select>
  );
}
