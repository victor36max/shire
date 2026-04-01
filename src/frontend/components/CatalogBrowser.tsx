import * as React from "react";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription } from "./ui/dialog";
import { Input } from "./ui/input";
import { Button } from "./ui/button";
import { Badge } from "./ui/badge";
import { Card, CardHeader, CardTitle, CardDescription, CardContent } from "./ui/card";
import { Spinner } from "./ui/spinner";
import { useCatalogAgents, useCatalogCategories } from "../hooks";

interface CatalogBrowserProps {
  open: boolean;
  onClose: () => void;
  onAdd: (agentName: string) => void;
}

export default function CatalogBrowser({ open, onClose, onAdd }: CatalogBrowserProps) {
  const { data: agents = [], isLoading: agentsLoading } = useCatalogAgents(open);
  const { data: categories = [], isLoading: categoriesLoading } = useCatalogCategories(open);

  const loading = agentsLoading || categoriesLoading;

  const [search, setSearch] = React.useState("");
  const [selectedCategory, setSelectedCategory] = React.useState<string | null>(null);

  React.useEffect(() => {
    if (open) {
      setSearch("");
      setSelectedCategory(null);
    }
  }, [open]);

  const filteredAgents = React.useMemo(() => {
    let result = agents;

    if (selectedCategory) {
      result = result.filter((a) => a.category === selectedCategory);
    }

    if (search.trim()) {
      const q = search.toLowerCase();
      result = result.filter(
        (a) =>
          a.displayName.toLowerCase().includes(q) ||
          a.description.toLowerCase().includes(q) ||
          a.tags.some((t) => t.toLowerCase().includes(q)),
      );
    }

    return result;
  }, [agents, selectedCategory, search]);

  const visibleCategories = React.useMemo(() => {
    const agentCategories = new Set(agents.map((a) => a.category));
    return categories.filter((c) => agentCategories.has(c.id));
  }, [agents, categories]);

  if (loading || agents.length === 0) {
    return (
      <Dialog open={open} onOpenChange={(isOpen) => !isOpen && onClose()}>
        <DialogContent className="max-w-lg">
          <DialogHeader>
            <DialogTitle>Agent Catalog</DialogTitle>
            <DialogDescription>
              Browse and add pre-defined agents to your project.
            </DialogDescription>
          </DialogHeader>
          {loading ? (
            <div className="flex items-center justify-center gap-2 py-8">
              <Spinner size="sm" className="text-muted-foreground" />
              <span className="text-sm text-muted-foreground">Loading catalog...</span>
            </div>
          ) : (
            <p className="text-sm text-muted-foreground py-8 text-center">
              No agents in catalog. Run <code>mix catalog.sync</code> to import agents.
            </p>
          )}
        </DialogContent>
      </Dialog>
    );
  }

  return (
    <Dialog open={open} onOpenChange={(isOpen) => !isOpen && onClose()}>
      <DialogContent className="max-w-4xl max-h-[85vh] flex flex-col">
        <DialogHeader>
          <DialogTitle>Agent Catalog</DialogTitle>
          <DialogDescription>Browse and add pre-defined agents to your project.</DialogDescription>
        </DialogHeader>

        <Input
          placeholder="Search agents..."
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          className="mb-4"
        />

        <div className="flex gap-4 flex-1 min-h-0">
          <div className="w-40 shrink-0 space-y-1">
            <Button
              variant={selectedCategory === null ? "secondary" : "ghost"}
              size="sm"
              className="w-full justify-start"
              onClick={() => setSelectedCategory(null)}
            >
              All
            </Button>
            {visibleCategories.map((cat) => (
              <Button
                key={cat.id}
                variant={selectedCategory === cat.id ? "secondary" : "ghost"}
                size="sm"
                className="w-full justify-start"
                onClick={() => setSelectedCategory(cat.id)}
              >
                {cat.name}
              </Button>
            ))}
          </div>

          <div className="flex-1 overflow-y-auto">
            {filteredAgents.length === 0 ? (
              <p className="text-sm text-muted-foreground py-8 text-center">
                No agents match your search.
              </p>
            ) : (
              <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-3">
                {filteredAgents.map((agent) => (
                  <Card key={agent.name} className="flex flex-col">
                    <CardHeader className="pb-2">
                      <div className="flex items-center gap-2">
                        <span className="text-lg shrink-0">{agent.emoji}</span>
                        <CardTitle className="text-sm line-clamp-2">{agent.displayName}</CardTitle>
                      </div>
                      <Badge variant="secondary" className="text-xs w-fit">
                        {agent.category}
                      </Badge>
                    </CardHeader>
                    <CardContent className="flex-1 pb-3">
                      <CardDescription className="text-xs line-clamp-2">
                        {agent.description}
                      </CardDescription>
                    </CardContent>
                    <div className="px-6 pb-4">
                      <Button
                        size="sm"
                        variant="outline"
                        className="w-full"
                        onClick={() => onAdd(agent.name)}
                      >
                        Add
                      </Button>
                    </div>
                  </Card>
                ))}
              </div>
            )}
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}
