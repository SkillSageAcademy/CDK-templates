import * as cdk from 'aws-cdk-lib';
import * as iam from 'aws-cdk-lib/aws-iam';
import * as lambda from 'aws-cdk-lib/aws-lambda';
import * as logs from 'aws-cdk-lib/aws-logs';
import * as s3 from 'aws-cdk-lib/aws-s3';
import * as sns from 'aws-cdk-lib/aws-sns';
import * as subs from 'aws-cdk-lib/aws-sns-subscriptions';
import * as sfn from 'aws-cdk-lib/aws-stepfunctions';
import * as tasks from 'aws-cdk-lib/aws-stepfunctions-tasks';
import { Construct } from 'constructs';

export interface StateFunctionsResources extends cdk.StackProps {
    readonly step1LambdaFunction: string,
    readonly step2LambdaFunction: string,
    readonly step3LambdaFunction: string,
    readonly sampleCodeBucket: string,
}

export class StateFunctions extends cdk.Stack {
    constructor(scope: Construct, id: string, props: StateFunctionsResources) {
        super(scope, id, props);

        const sampleCodeBucket = s3.Bucket.fromBucketName(
            this,
            'SampleCodeBucket',
            props.sampleCodeBucket
        );

        const emailNotificationTopic = new sns.Topic(
            this,
            'EmailNotificationTopic',
            {
                displayName: 'EmailNotificationTopic',
                topicName: 'email-notification-topic'
            }
        );
        emailNotificationTopic.addSubscription(
            new subs.EmailSubscription('sample@example.com')
        );

        this.createStepFunction(props, emailNotificationTopic, sampleCodeBucket)

    }

    private createStepFunction(
        props: StateFunctionsResources,
        emailNotificationTopic: any,
        sampleCodeBucket: any
    ): any {
        // Step 1: Lambda Function:
        const step1EnvVariable = {
            TABLE_NAME: "TableName"
        };
        const step1LambdaFunction = this.createLambdaFunctionAndRole(
            props.step1LambdaFunction,
            emailNotificationTopic,
            sampleCodeBucket,
            step1EnvVariable
        );

        // Step 2: Lambda Function
        const step2EnvVariable = {
            OTHER_ENV_VARIABLE: "VALUE"
        };
        const step2LambdaFunction = this.createLambdaFunctionAndRole(
            props.step2LambdaFunction,
            emailNotificationTopic,
            sampleCodeBucket,
            step2EnvVariable
        );


        // Step 3: Lambda Function
        const step3EnvVariable = {
            SOME_ENV_VARIABLE: "env Variable value"
        };
        const memorySize = 6144;
        const step3LambdaFunction = this.createLambdaFunctionAndRole(
            props.step3LambdaFunction,
            emailNotificationTopic,
            sampleCodeBucket,
            step3EnvVariable,
            memorySize
        );

        // Step Function Definition
        const definition = new tasks.LambdaInvoke(
            this,
            'step1LambdaFunction',
            {
                lambdaFunction: step1LambdaFunction.lambdaFunction,
                stateName: 'step1LambdaFunction',
                comment: 'Step 1 Lambda Function',
                invocationType: tasks.LambdaInvocationType.REQUEST_RESPONSE,
                outputPath: '$.Payload'
            }
        ).next(
            new sfn.Choice(this, 'Step1LambdaFunctionChoice', {
                stateName: 'Step1LambdaFunctionChoice',
                comment: 'Step 1 Lambda Function Choice',
                inputPath: '$',
                outputPath: '$'
            })
                .when(
                    sfn.Condition.stringEquals('$.state', 'Yes'),
                    new sfn.Succeed(this, 'ProcessEnded')
                )
                .otherwise(
                    new tasks.LambdaInvoke(this, 'Step2LambdaFunction', {
                        lambdaFunction: step2LambdaFunction.lambdaFunction,
                        stateName: 'step2LambdaFunction',
                        comment: 'Step 2 Lambda Function',
                        invocationType: tasks.LambdaInvocationType.REQUEST_RESPONSE,
                        outputPath: '$.Payload',
                        inputPath: '$'
                    }).next(
                        new tasks.LambdaInvoke(
                            this,
                            'step3LambdaFunction',
                            {
                                lambdaFunction:
                                    step3LambdaFunction.lambdaFunction,
                                stateName: 'step3LambdaFunction',
                                comment: 'Step 3 Lambda Function',
                                invocationType: tasks.LambdaInvocationType.EVENT,
                                outputPath: '$',
                                inputPath: '$'
                            }
                        ).next(new sfn.Succeed(this, 'WorkflowCompleted'))
                    )
                )
        );

        // Step Function State Machine
        // Create an IAM role for the Step Functions State Machine
        const stateMachineRole = new iam.Role(
            this,
            'StepFunctionStateMachineRole',
            {
                assumedBy: new iam.ServicePrincipal('states.amazonaws.com'),
                // Add any additional policies or permissions as needed
                description: 'Step Function State Machine Role',
                roleName: 'step-function-state-machine-role',
                inlinePolicies: {
                    createCloudWatchLogsPolicy: new iam.PolicyDocument({
                        statements: [
                            new iam.PolicyStatement({
                                actions: [
                                    'logs:CreateLogDelivery',
                                    'logs:GetLogDelivery',
                                    'logs:UpdateLogDelivery',
                                    'logs:DeleteLogDelivery',
                                    'logs:ListLogDeliveries',
                                    'logs:PutResourcePolicy',
                                    'logs:DescribeResourcePolicies',
                                    'logs:DescribeLogGroups'
                                ],
                                resources: ['*']
                            })
                        ]
                    }),
                    invokeLambdaFunction: new iam.PolicyDocument({
                        statements: [
                            new iam.PolicyStatement({
                                actions: ['lambda:InvokeFunction'],
                                resources: [
                                    'arn:aws:lambda:eu-west-1:065741335689:function:step1LambdaFunction:*',
                                    'arn:aws:lambda:eu-west-1:065741335689:function:step1LambdaFunction'
                                ]
                            })
                        ]
                    }),
                    snsInvoke: new iam.PolicyDocument({
                        statements: [
                            new iam.PolicyStatement({
                                actions: ['sns:*'],
                                resources: ['*']
                            })
                        ]
                    }),
                    xraySegments: new iam.PolicyDocument({
                        statements: [
                            new iam.PolicyStatement({
                                actions: [
                                    'xray:PutTraceSegments',
                                    'xray:PutTelemetryRecords',
                                    'xray:GetSamplingRules',
                                    'xray:GetSamplingTargets'
                                ],
                                resources: ['*']
                            })
                        ]
                    })
                }
            }
        );

        const stepFunctionsLogGroup = new logs.LogGroup(
            this,
            'StepFunctionStateMachineLogGroup'
        );

        const stateMachine = new sfn.StateMachine(
            this,
            'StepFunctionStateMachine',
            {
                comment: 'Step Function State machine',
                stateMachineName: 'StepFunctionStateMachine',
                stateMachineType: sfn.StateMachineType.STANDARD,
                definitionBody: sfn.DefinitionBody.fromChainable(definition),
                timeout: cdk.Duration.minutes(30),
                role: stateMachineRole,
                logs: {
                    destination: stepFunctionsLogGroup,
                    level: sfn.LogLevel.ALL,
                    includeExecutionData: true
                }
            }
        );
    }


    private createLambdaFunctionAndRole(
        functionName: string,
        emailNotificationTopic: any,
        sampleCodeBucket: any,
        envVariable: any = {},
        memorySize = 1024
    ): any {
        // Create an IAM role for the Lambda function
        const lambdaRole = new iam.Role(this, `${functionName}Role`, {
            assumedBy: new iam.ServicePrincipal('lambda.amazonaws.com'),
            description: `${functionName}Lambda Function Role`,
            roleName: `${functionName}LambdaFunctionRole`,
            managedPolicies: [
                iam.ManagedPolicy.fromAwsManagedPolicyName(
                    'service-role/AWSLambdaBasicExecutionRole'
                )
            ]
        });
        emailNotificationTopic.grantPublish(lambdaRole);

        const lambdaFunction = new lambda.Function(this, functionName, {
            functionName,
            description: functionName,
            runtime: lambda.Runtime.PROVIDED_AL2,
            memorySize,
            timeout: cdk.Duration.minutes(15),
            retryAttempts: 0,
            handler: 'bootstrap',
            code: lambda.Code.fromBucket(
                sampleCodeBucket,
                'sample-golang-project/golang-sample.zip'
            ),
            environment: envVariable,
            role: lambdaRole,
            deadLetterTopic: emailNotificationTopic
        });

        // Add tags to DynamoDB Table
        cdk.Tags.of(lambdaFunction).add('site', 'phase-two-core');
        cdk.Tags.of(lambdaFunction).add('author', 'Nagarjun Nagesh');

        // Add CloudWatch logs permission to the Lambda function's role
        this.createLogGroups(lambdaFunction, functionName);

        return { lambdaFunction, lambdaRole };
    }


    private createLogGroups(
        lambdaFunction: cdk.aws_lambda.Function,
        functionName: string
    ): void {
        const logGroupArn = `arn:aws:logs:${cdk.Aws.REGION}:${cdk.Aws.ACCOUNT_ID}:log-group:/aws/lambda/${lambdaFunction.functionName}:*`;
        const createLogGroupStatement = new iam.PolicyStatement({
            effect: iam.Effect.ALLOW,
            actions: [
                'logs:CreateLogGroup',
                'logs:CreateLogStream',
                'logs:PutLogEvents'
            ],
            resources: [logGroupArn]
        });

        lambdaFunction.role?.attachInlinePolicy(
            new iam.Policy(this, `${functionName}createLogGroupPolicy`, {
                statements: [createLogGroupStatement]
            })
        );
    }

}