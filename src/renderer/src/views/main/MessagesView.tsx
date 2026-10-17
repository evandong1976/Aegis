import { Card, EmptyState } from '../../components/ds'

// Photon threads (milestone 5). Threads are stored only on this Mac and can be deleted here.
export default function MessagesView(): React.JSX.Element {
  return (
    <Card
      title="Threads"
      description="Texts and emails you forwarded to Aegis, with the verdict it sent back. Stored only on this Mac."
    >
      <EmptyState
        icon="message-square"
        title="No threads yet"
        description="Once Photon is connected (milestone 5), forward a suspicious text or email to Aegis and the conversation shows up here, linked to its scans."
      />
    </Card>
  )
}
