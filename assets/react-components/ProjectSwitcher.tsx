import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "./components/ui/select";
import { navigate } from "./lib/navigate";
import type { Project } from "./types";

interface ProjectSwitcherProps {
  projects: Project[];
  currentProject: string;
}

export default function ProjectSwitcher({ projects, currentProject }: ProjectSwitcherProps) {
  return (
    <Select
      value={currentProject}
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
          <SelectItem key={project.name} value={project.name}>
            {project.name}
          </SelectItem>
        ))}
        <SelectItem value="__all__">All Projects</SelectItem>
      </SelectContent>
    </Select>
  );
}
