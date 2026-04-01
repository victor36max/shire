import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "./ui/select";
import { useNavigate } from "react-router-dom";
import type { Project } from "./types";

interface ProjectSwitcherProps {
  projects: Project[];
  currentProjectName: string;
}

export default function ProjectSwitcher({ projects, currentProjectName }: ProjectSwitcherProps) {
  const navigate = useNavigate();
  return (
    <Select
      value={currentProjectName}
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
          <SelectItem key={project.id} value={project.name}>
            {project.name}
          </SelectItem>
        ))}
        <SelectItem value="__all__">All Projects</SelectItem>
      </SelectContent>
    </Select>
  );
}
