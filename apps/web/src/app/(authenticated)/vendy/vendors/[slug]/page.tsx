import VendorProfileClient from './VendorProfileClient'

interface Props {
  params: Promise<{ slug: string }>
}

export default async function VendorProfilePage({ params }: Props) {
  const { slug } = await params
  return <VendorProfileClient slug={slug} />
}
