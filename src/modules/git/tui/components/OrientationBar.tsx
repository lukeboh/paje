import React from "react";
import { Box, Text } from "ink";

export type OrientationBarProps = {
  message: string;
};

const OrientationBarComponent: React.FC<OrientationBarProps> = ({ message }) => {
  return (
    <Box flexDirection="row" width="100%" height={1}>
      <Text wrap="truncate-end">{message}</Text>
    </Box>
  );
};

export const OrientationBar = React.memo(OrientationBarComponent);
