import * as cdk from "aws-cdk-lib";
import { Construct } from "constructs";
import { Dynamo } from "./constructs/dynamo";
import { Rule } from "aws-cdk-lib/aws-events";
import { CloudWatchLogGroup } from "aws-cdk-lib/aws-events-targets";
import { LogGroup, RetentionDays } from "aws-cdk-lib/aws-logs";

export interface CdkDynamodbCdcStackProps extends cdk.StackProps {
  cdcLogs?: boolean;
  eventSource: string;
  tableId?: string;
}

export class CdkDynamodbCdcStack extends cdk.Stack {
  constructor(scope: Construct, id: string, props: CdkDynamodbCdcStackProps) {
    super(scope, id, props);

    const { eventSource, tableId } = props;

    new Dynamo(this, tableId || 'Table', {
      eventSource,
      changeDataCapture: {},
    });

    if (props.cdcLogs) {
      const eventObserver = new LogGroup(this, "cdcObserver", {
        logGroupName: `/${id}/dynamo-cdc`,
        removalPolicy: cdk.RemovalPolicy.DESTROY,
        retention: RetentionDays.ONE_WEEK,
      });

      new Rule(this, "eventRule", {
        eventPattern: {
          source: [eventSource],
          detailType: ["dynamo.item.changed"],
        },
        targets: [new CloudWatchLogGroup(eventObserver)],
      });
    }
  }
}
