import * as cdk from "aws-cdk-lib";
import { Construct } from "constructs";
import { Dynamo } from "./constructs/dynamo";
import { Rule } from "aws-cdk-lib/aws-events";
import { CloudWatchLogGroup } from "aws-cdk-lib/aws-events-targets";
import { LogGroup, RetentionDays } from "aws-cdk-lib/aws-logs";

export class CdkDynamodbCdcStack extends cdk.Stack {
  constructor(scope: Construct, id: string, props?: cdk.StackProps) {
    super(scope, id, props);

    new Dynamo(this, "MyDynamoTable", {
      eventSource: "martzcodes",
      changeDataCapture: {},
    });

    // for demo purposes, we'll just log the events to a CloudWatch Log Group
    const eventObserver = new LogGroup(this, 'cdcObserver', {
      logGroupName: '/martzcodes/dynamo-cdc',
      removalPolicy: cdk.RemovalPolicy.DESTROY,
      retention: RetentionDays.ONE_WEEK,
    });

    new Rule(this, 'eventRule', {
      eventPattern: {
        source: ['martzcodes'],
        detailType: ['dynamo.item.changed'],
      },
      targets: [new CloudWatchLogGroup(eventObserver)],
    });
  }
}
