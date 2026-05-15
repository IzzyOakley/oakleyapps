import BidReviewClient from './BidReviewClient'

export default async function BidReviewPage({ params }: { params: Promise<{ project_id: string; bid_id: string }> }) {
  const { project_id, bid_id } = await params
  return <BidReviewClient projectId={project_id} bidId={bid_id} />
}
