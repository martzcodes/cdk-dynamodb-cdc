import { RemovalPolicy, Duration } from "aws-cdk-lib";
import {
  TablePropsV2,
  AttributeType,
  ProjectionType,
  StreamViewType,
  TableV2,
  GlobalSecondaryIndexPropsV2,
} from "aws-cdk-lib/aws-dynamodb";
import { EventBus } from "aws-cdk-lib/aws-events";
import { Bucket, BlockPublicAccess, ObjectOwnership } from "aws-cdk-lib/aws-s3";
import {
  DynamoEventSource,
  DynamoEventSourceProps,
} from "aws-cdk-lib/aws-lambda-event-sources";
import {
  Architecture,
  Runtime,
  StartingPosition,
  FilterCriteria,
  FilterRule,
} from "aws-cdk-lib/aws-lambda";
import { LogGroup, LogGroupProps, RetentionDays } from "aws-cdk-lib/aws-logs";
import { NodejsFunction } from "aws-cdk-lib/aws-lambda-nodejs";
import { Construct } from "constructs";
import { existsSync } from "fs";
import { join } from "path";

interface ChangeDataCapture {
  // Override the default CDC Handler
  functionPath?: string;
  pkFilters?: string[];
  logProps?: Partial<LogGroupProps>;
}

export interface DynamoProps {
  changeDataCapture?: ChangeDataCapture;
  eventSource: string;
  gsiIndexNames?: string[];
  tableId?: string;
  tableProps?: Partial<TablePropsV2>;
}

export class Dynamo extends Construct {
  table: TableV2;
  cdcBucket: Bucket;
  cdcFn: NodejsFunction;
  constructor(scope: Construct, id: string, props: DynamoProps) {
    super(scope, id);

    const {
      changeDataCapture,
      eventSource,
      gsiIndexNames = [] as string[],
      tableId = "Table",
      tableProps: tablePropOverrides = {},
    } = props;

    let tableProps: TablePropsV2 = {
      partitionKey: { name: "pk", type: AttributeType.STRING },
      sortKey: { name: "sk", type: AttributeType.STRING },
      removalPolicy: RemovalPolicy.DESTROY,
      timeToLiveAttribute: "ttl",
      ...tablePropOverrides,
    };
    if (changeDataCapture) {
      tableProps = {
        ...tableProps,
        dynamoStream: StreamViewType.NEW_AND_OLD_IMAGES,
      };
    }

    this.table = new TableV2(this, tableId, tableProps);

    for (const gsi of gsiIndexNames) {
      const gsiCreateParams: GlobalSecondaryIndexPropsV2 = {
        indexName: gsi,
        partitionKey: { name: `${gsi}pk`, type: AttributeType.STRING },
        sortKey: { name: `${gsi}sk`, type: AttributeType.STRING },
        projectionType: ProjectionType.ALL,
      };
      this.table.addGlobalSecondaryIndex(gsiCreateParams);
    }

    if (changeDataCapture) {
      this.cdcFn = this.createDynamoStreamHandlerFn({
        changeDataCapture,
        table: this.table,
      });
      this.cdcFn.addEnvironment("EVENT_SOURCE", eventSource);
    }
  }

  createDynamoStreamHandlerFn(args: {
    changeDataCapture: ChangeDataCapture;
    table: TableV2;
  }) {
    const { changeDataCapture, table } = args;
    const {
      functionPath,
      pkFilters,
      logProps: logPropOverrides = {},
    } = changeDataCapture;

    this.cdcBucket = new Bucket(this, "DynamoCDCBucket", {
      blockPublicAccess: BlockPublicAccess.BLOCK_ALL,
      removalPolicy: RemovalPolicy.DESTROY,
      autoDeleteObjects: true,
      eventBridgeEnabled: true,
      objectOwnership: ObjectOwnership.BUCKET_OWNER_ENFORCED,
      lifecycleRules: [
        {
          expiration: Duration.hours(24),
          enabled: true,
        },
      ],
    });

    const localMode = existsSync(
      join(__dirname, `../lambda/dynamo-stream-handler.ts`)
    );
    const entry = localMode
      ? join(__dirname, `../lambda/dynamo-stream-handler.ts`)
      : join(__dirname, `../lambda/dynamo-stream-handler.js`);

    const fnId = "DynamoCDC";
    const fn = new NodejsFunction(this, `${fnId}Fn`, {
      entry: functionPath || entry,
      runtime: Runtime.NODEJS_LATEST,
      architecture: Architecture.ARM_64,
      timeout: Duration.minutes(15),
      logRetention: RetentionDays.TWO_WEEKS,
      memorySize: 1024,
      bundling: {
        externalModules: [],
      },
      retryAttempts: 0,
    });
    new LogGroup(this, `${fnId}Logs`, {
      logGroupName: `/aws/lambda/${fn.functionName}`,
      retention: RetentionDays.TWO_WEEKS,
      removalPolicy: RemovalPolicy.DESTROY,
      ...logPropOverrides,
    });
    fn.addEnvironment("BUCKET_NAME", this.cdcBucket.bucketName);
    this.cdcBucket.grantRead(fn);
    this.cdcBucket.grantWrite(fn);

    fn.addEnvironment("TABLE_NAME", table.tableName);
    table.grantReadData(fn);
    table.grantWriteData(fn);

    let dynamoEventSourceProps: DynamoEventSourceProps = {
      startingPosition: StartingPosition.LATEST,
    };

    if (pkFilters) {
      const filterRules = pkFilters.map((pkFilter) => {
        const splitFilter = pkFilter.split("*");
        switch (splitFilter.length) {
          case 1:
            const f1 = FilterRule.isEqual(pkFilter);
            // It returns an array of strings with length of 1
            return f1[0];
          case 2:
            const f2 = FilterRule.beginsWith(splitFilter[0]);
            // It returns an array of objects with length of 1
            // Object looks like this: { prefix: VALUE }
            return f2[0];
          default:
            throw new Error(`Invalid pkFilter: ${pkFilter}`);
        }
      });

      const filters = [
        FilterCriteria.filter({
          dynamodb: {
            Keys: {
              pk: {
                S: filterRules,
              },
            },
          },
        }),
      ];

      dynamoEventSourceProps = {
        ...dynamoEventSourceProps,
        filters,
      };
    }

    fn.addEventSource(new DynamoEventSource(table, dynamoEventSourceProps));
    const bus = EventBus.fromEventBusName(this, "EventBus", "default");
    bus.grantPutEventsTo(fn);

    return fn;
  }
}
