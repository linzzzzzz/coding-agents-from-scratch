#!/usr/bin/env node
import React from 'react';
import { render } from 'ink';
import { App } from './ui/index.tsx';

render(React.createElement(App), {
  exitOnCtrlC: false,
});
