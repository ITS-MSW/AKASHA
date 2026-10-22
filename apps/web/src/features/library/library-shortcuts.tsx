import { QuestionIcon } from "@phosphor-icons/react"
import { Button, Kbd, Typography } from "@heroui/react"
import { HoverCard } from "@heroui-pro/react"

export function LibraryShortcuts() {
  return (
    <HoverCard closeDelay={120} openDelay={180}>
      <HoverCard.Trigger>
        <Button
          aria-label="Keyboard shortcuts"
          isIconOnly
          size="sm"
          variant="tertiary"
        >
          <QuestionIcon aria-hidden="true" size={16} weight="bold" />
        </Button>
      </HoverCard.Trigger>
      <HoverCard.Content placement="bottom end">
        <div className="grid min-w-[18rem] gap-3">
          <Typography type="h6">Keyboard shortcuts</Typography>
          <dl className="m-0 grid gap-2.5">
            <Shortcut label="Command palette">
              <Kbd>
                <Kbd.Abbr keyValue="command" />
                <Kbd.Content>K</Kbd.Content>
              </Kbd>
            </Shortcut>
            <Shortcut label="Switch theme">
              <Kbd>
                <Kbd.Content>D</Kbd.Content>
              </Kbd>
            </Shortcut>
            <Shortcut label="Switch library view">
              <Kbd>
                <Kbd.Content>S</Kbd.Content>
              </Kbd>
            </Shortcut>
            <Shortcut label="Switch media filter">
              <Kbd>
                <Kbd.Content>F</Kbd.Content>
              </Kbd>
            </Shortcut>
            <Shortcut label="Upload media">
              <Kbd>
                <Kbd.Content>U</Kbd.Content>
              </Kbd>
            </Shortcut>
            <Shortcut label="Add preview to pool">
              <Kbd>
                <Kbd.Content>P</Kbd.Content>
              </Kbd>
            </Shortcut>
            <Shortcut label="Select multiple assets">
              <Kbd>
                <Kbd.Content>M</Kbd.Content>
              </Kbd>
            </Shortcut>
            <Shortcut label="Move through folders or media">
              <span className="flex items-center gap-1.5">
                <Kbd>
                  <Kbd.Abbr keyValue="left" />
                </Kbd>
                <Kbd>
                  <Kbd.Abbr keyValue="right" />
                </Kbd>
              </span>
            </Shortcut>
            <Shortcut label="Go deeper">
              <Kbd>
                <Kbd.Abbr keyValue="up" />
              </Kbd>
            </Shortcut>
            <Shortcut label="Go to parent folder">
              <Kbd>
                <Kbd.Abbr keyValue="down" />
              </Kbd>
            </Shortcut>
            <Shortcut label="Open folder">
              <span className="flex items-center gap-1.5">
                <Kbd>
                  <Kbd.Abbr keyValue="space" />
                </Kbd>
                <Typography color="muted" type="body-sm">
                  or
                </Typography>
                <Kbd>
                  <Kbd.Abbr keyValue="enter" />
                </Kbd>
              </span>
            </Shortcut>
          </dl>
        </div>
      </HoverCard.Content>
    </HoverCard>
  )
}

function Shortcut({
  children,
  label,
}: {
  children: React.ReactNode
  label: string
}) {
  return (
    <div className="flex items-center justify-between gap-6">
      <dt className="m-0">
        <Typography color="muted" type="body-sm">
          {label}
        </Typography>
      </dt>
      <dd className="m-0">{children}</dd>
    </div>
  )
}
