#!/usr/bin/env node
import 'source-map-support/register';
import * as cdk from 'aws-cdk-lib';
import { CdkDynamodbCdcStack } from '../lib/cdk-dynamodb-cdc-stack';

const app = new cdk.App();
new CdkDynamodbCdcStack(app, 'CdkDynamodbCdcStack', {
  cdcLogs: true,
  eventSource: 'martzcodes',
});