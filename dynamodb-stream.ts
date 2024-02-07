import * as apigateway from 'aws-cdk-lib/aws-apigateway';
import * as dynamodb from 'aws-cdk-lib/aws-dynamodb';
import * as lambda from 'aws-cdk-lib/aws-lambda';
import * as lambdaEventSources from 'aws-cdk-lib/aws-lambda-event-sources';
import * as sns from 'aws-cdk-lib/aws-sns';
import * as subs from 'aws-cdk-lib/aws-sns-subscriptions';
import * as cdk from 'aws-cdk-lib/core';
import { Construct } from 'constructs';

export class ApiLambdaDynamoDbStack extends cdk.Stack {
    constructor(scope: Construct, id: string, props?: cdk.StackProps) {
        super(scope, id, props);

        // Step 1: Create DynamoDB table
        const table = new dynamodb.TableV2(
            this,
            'MyTable',
            {
                partitionKey: { name: 'pk', type: dynamodb.AttributeType.STRING },
                // Add more configurations as needed
                tableName: 'sample-table',
                removalPolicy: cdk.RemovalPolicy.DESTROY, // Adjust the removal policy based on your needs
                dynamoStream: dynamodb.StreamViewType.NEW_IMAGE, // Enable DynamoDB Stream with NEW_IMAGE view type

                // Time-to-Live (TTL) Configuration
                timeToLiveAttribute: 'csv_ttl', // Specify the attribute name for TTL,

                billing: dynamodb.Billing.onDemand(),
                encryption: dynamodb.TableEncryptionV2.awsManagedKey()
            }
        );

        // Create Lambda function to handle API Gateway requests
        const apiHandler = new lambda.Function(this, 'ApiHandler', {
            runtime: lambda.Runtime.NODEJS_LATEST,
            handler: 'index.handler',
            code: lambda.Code.fromAsset('lambda'),
            environment: {
                TABLE_NAME: table.tableName
            }
        });

        // Grant permissions to Lambda to access DynamoDB
        table.grantWriteData(apiHandler);

        // Create API Gateway
        const api = new apigateway.RestApi(this, 'MyApi');
        const integration = new apigateway.LambdaIntegration(apiHandler);
        api.root.addMethod('POST', integration);

        // Create Lambda function to handle DynamoDB stream
        const streamHandler = new lambda.Function(this, 'StreamHandler', {
            runtime: lambda.Runtime.NODEJS_LATEST,
            handler: 'index.handler',
            code: lambda.Code.fromAsset('lambda'),
            environment: {
                TABLE_NAME: table.tableName
            }
        });

        // Grant permissions to Lambda to read from DynamoDB stream
        table.grantStreamRead(streamHandler);

        // Create a Dead Letter Topic
        // Step 2.1: Create SNS Topic
        const deadLetterQueue = new sns.Topic(
            this,
            'DeadLetterQueue',
            {
                displayName: 'DeadLetterQueue',
                topicName: 'email-notification-topic'
            }
        );
        deadLetterQueue.addSubscription(
            new subs.EmailSubscription('nagarjun@example.com')
        );

        // Configure DynamoDB stream to trigger Lambda function
        streamHandler.addEventSource(
            new lambdaEventSources.DynamoEventSource(table, {
                startingPosition: lambda.StartingPosition.LATEST,
                batchSize: 5, // Adjust the batch size as needed
                bisectBatchOnError: true,
                enabled: true,
                retryAttempts: 3,
                onFailure: new lambdaEventSources.SnsDlq(deadLetterQueue),
                filters: [
                    {
                        awsRegion: ['eu-west-1'],
                        dynamodb: {
                            NewImage: { stored_all_batched_content: { BOOL: [true] } },
                            StreamViewType: ['NEW_IMAGE']
                        },
                        eventName: ['MODIFY'],
                        eventSource: ['aws:dynamodb']
                    }
                ]
            })
        );
    }

    
}