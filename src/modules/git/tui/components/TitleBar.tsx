import React from "react";
import { Box, Text } from "ink";

export type TitleBarProps = {
  left: string;
  right: string;
  status?: string;
};

const TitleBarComponent: React.FC<TitleBarProps> = ({ left, right, status }) => {
  return (
    <Box flexDirection="row" height={1} width="100%" justifyContent="space-between">
      <Text>{left}</Text>
      <Box flexDirection="row">
        {status ? <Text color="cyan">{status}  </Text> : null}
        <Text>{right}</Text>
      </Box>
    </Box>
  );
};

export const TitleBar = React.memo(TitleBarComponent);
