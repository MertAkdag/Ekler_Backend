import React, { useEffect, useState } from 'react'
import type { BasePropertyProps } from 'adminjs'
import { Box, Text } from '@adminjs/design-system'

/**
 * Image thumbnail for URL columns (avatar_url / image_url / cover_url). Bigger on
 * the show view; circular when property.custom.shape === 'circle'. Falls back to a
 * dash on null/empty or a broken image (onError).
 */
const Thumbnail: React.FC<BasePropertyProps> = ({ record, property, where }) => {
  const url = record?.params?.[property.path] as string | undefined
  const [broken, setBroken] = useState(false)

  // List slots are reused positionally across pagination/sort — reset on url change
  // so a previously-broken image doesn't suppress a now-valid one.
  useEffect(() => setBroken(false), [url])

  if (!url || broken) {
    return (
      <Text as="span" color="grey60">
        —
      </Text>
    )
  }

  const isShow = where === 'show'
  const size = isShow ? 120 : 40
  const circle = property.custom?.shape === 'circle'

  return (
    <Box
      as="img"
      src={url}
      alt=""
      width={size}
      height={size}
      borderRadius={circle ? 9999 : isShow ? 8 : 4}
      bg="grey20"
      style={{ objectFit: 'cover', display: 'block' }}
      onError={() => setBroken(true)}
    />
  )
}

export default Thumbnail
