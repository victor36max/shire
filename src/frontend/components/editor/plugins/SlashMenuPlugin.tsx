import {
  LexicalTypeaheadMenuPlugin,
  MenuOption,
  MenuRenderFn,
  useBasicTypeaheadTriggerMatch,
} from "@lexical/react/LexicalTypeaheadMenuPlugin";
import {
  $createParagraphNode,
  $getSelection,
  $isRangeSelection,
  LexicalEditor,
  TextNode,
} from "lexical";

import {
  INSERT_CHECK_LIST_COMMAND,
  INSERT_ORDERED_LIST_COMMAND,
  INSERT_UNORDERED_LIST_COMMAND,
} from "@lexical/list";
import { $setBlocksType } from "@lexical/selection";
import { $createHeadingNode, $createQuoteNode } from "@lexical/rich-text";
import { useLexicalComposerContext } from "@lexical/react/LexicalComposerContext";
import { useCallback, useMemo } from "react";
import { createPortal } from "react-dom";
import { cn } from "../../lib/utils";
import {
  Code,
  Heading1,
  Heading2,
  Heading3,
  Image,
  List,
  ListChecks,
  ListOrdered,
  SeparatorHorizontal,
  Table,
  Text,
  TextQuote,
} from "lucide-react";
import { $createCodeNode } from "@lexical/code";
import { INSERT_HORIZONTAL_RULE_COMMAND } from "@lexical/react/LexicalHorizontalRuleNode";
import { OPEN_INSERT_TABLE_MENU_COMMAND } from "./table-commands";
import { OPEN_INSERT_IMAGE_DIALOG_COMMAND } from "./image-commands";

class SlashMenuOption extends MenuOption {
  title: string;
  icon?: React.JSX.Element;
  keywords: Array<string>;
  onSelect: (queryString: string) => void;

  constructor(
    title: string,
    options: {
      icon?: React.JSX.Element;
      keywords?: Array<string>;
      onSelect: (queryString: string) => void;
    },
  ) {
    super(title);
    this.title = title;
    this.keywords = options.keywords || [];
    this.icon = options.icon;
    this.onSelect = options.onSelect.bind(this);
  }
}

const getMenuOptions = (
  editor: LexicalEditor,
  actions: {
    openInsertTableMenu: () => void;
    openInsertImageDialog: () => void;
  },
): Array<SlashMenuOption> => {
  return [
    new SlashMenuOption("Paragraph", {
      icon: <Text className="w-4 h-4" />,
      keywords: ["normal", "paragraph", "p", "text"],
      onSelect: () =>
        editor.update(() => {
          const selection = $getSelection();
          if ($isRangeSelection(selection)) {
            $setBlocksType(selection, () => $createParagraphNode());
          }
        }),
    }),
    ...([1, 2, 3] as const).map(
      (n) =>
        new SlashMenuOption(`Heading ${n}`, {
          keywords: ["heading", "header", `h${n}`],
          icon: (() => {
            switch (n) {
              case 1:
                return <Heading1 className="w-4 h-4" />;
              case 2:
                return <Heading2 className="w-4 h-4" />;
              case 3:
              default:
                return <Heading3 className="w-4 h-4" />;
            }
          })(),
          onSelect: () =>
            editor.update(() => {
              const selection = $getSelection();
              if ($isRangeSelection(selection)) {
                $setBlocksType(selection, () => $createHeadingNode(`h${n}`));
              }
            }),
        }),
    ),
    new SlashMenuOption("Numbered List", {
      icon: <ListOrdered className="w-4 h-4" />,
      keywords: ["numbered list", "ordered list", "ol"],
      onSelect: () => editor.dispatchCommand(INSERT_ORDERED_LIST_COMMAND, undefined),
    }),
    new SlashMenuOption("Bulleted List", {
      icon: <List className="w-4 h-4" />,
      keywords: ["bulleted list", "unordered list", "ul"],
      onSelect: () => editor.dispatchCommand(INSERT_UNORDERED_LIST_COMMAND, undefined),
    }),
    new SlashMenuOption("Check List", {
      icon: <ListChecks className="w-4 h-4" />,
      keywords: ["check list", "todo list", "task list"],
      onSelect: () => editor.dispatchCommand(INSERT_CHECK_LIST_COMMAND, undefined),
    }),
    new SlashMenuOption("Quote", {
      icon: <TextQuote className="w-4 h-4" />,
      keywords: ["block quote"],
      onSelect: () =>
        editor.update(() => {
          const selection = $getSelection();
          if ($isRangeSelection(selection)) {
            $setBlocksType(selection, () => $createQuoteNode());
          }
        }),
    }),
    new SlashMenuOption("Table", {
      icon: <Table className="w-4 h-4" />,
      keywords: ["table", "grid"],
      onSelect: () => actions.openInsertTableMenu(),
    }),
    new SlashMenuOption("Image", {
      icon: <Image className="w-4 h-4" />,
      keywords: ["image", "photo", "picture", "file", "url", "link"],
      onSelect: () => actions.openInsertImageDialog(),
    }),
    new SlashMenuOption("Code", {
      icon: <Code className="w-4 h-4" />,
      keywords: ["code"],
      onSelect: () => {
        editor.update(() => {
          const selection = $getSelection();
          if ($isRangeSelection(selection)) {
            $setBlocksType(selection, () => $createCodeNode());
          }
        });
      },
    }),
    new SlashMenuOption("Horizontal Rule", {
      icon: <SeparatorHorizontal className="w-4 h-4" />,
      keywords: ["horizontal rule", "hr", "separator"],
      onSelect: () => editor.dispatchCommand(INSERT_HORIZONTAL_RULE_COMMAND, undefined),
    }),
  ];
};

export const SlashMenuPlugin = (): React.JSX.Element => {
  const [editor] = useLexicalComposerContext();

  const checkForTriggerMatch = useBasicTypeaheadTriggerMatch("/", {
    allowWhitespace: true,
    minLength: 0,
  });

  const menuOptions = useMemo(
    () =>
      getMenuOptions(editor, {
        openInsertTableMenu: () => {
          editor.dispatchCommand(OPEN_INSERT_TABLE_MENU_COMMAND, undefined);
        },
        openInsertImageDialog: () => {
          editor.dispatchCommand(OPEN_INSERT_IMAGE_DIALOG_COMMAND, undefined);
        },
      }),
    [editor],
  );

  const handleSelectOption = useCallback(
    (
      selectedOption: SlashMenuOption,
      nodeToRemove: TextNode | null,
      closeMenu: () => void,
      matchingString: string,
    ) => {
      editor.update(() => {
        nodeToRemove?.remove();
        selectedOption.onSelect(matchingString);
        closeMenu();
      });
    },
    [editor],
  );

  const renderMenu: MenuRenderFn<SlashMenuOption> = (
    anchorElementRef,
    { selectedIndex, selectOptionAndCleanUp, setHighlightedIndex },
  ) => {
    if (!anchorElementRef.current) return null;
    return createPortal(
      <ul className="min-w-[180px] rounded-lg border border-border bg-background shadow-md">
        {menuOptions.map((option, i) => (
          <li
            className={cn(
              "px-3 py-2 flex flex-row gap-2 items-center text-sm cursor-pointer",
              selectedIndex === i && "bg-accent",
              i !== 0 && "border-t border-border",
            )}
            key={option.title}
            onClick={() => {
              setHighlightedIndex(i);
              selectOptionAndCleanUp(option);
            }}
            onMouseEnter={() => {
              setHighlightedIndex(i);
            }}
          >
            {option.icon}
            {option.title}
          </li>
        ))}
      </ul>,
      anchorElementRef.current,
    );
  };

  return (
    <LexicalTypeaheadMenuPlugin
      onQueryChange={() => {}}
      onSelectOption={handleSelectOption}
      options={menuOptions}
      menuRenderFn={renderMenu}
      triggerFn={checkForTriggerMatch}
    />
  );
};
