import * as cdk from 'aws-cdk-lib';
import * as apigateway from 'aws-cdk-lib/aws-apigateway';
import * as acm from 'aws-cdk-lib/aws-certificatemanager';
import * as iam from 'aws-cdk-lib/aws-iam';
import * as lambda from 'aws-cdk-lib/aws-lambda';
import * as route53 from 'aws-cdk-lib/aws-route53';
import * as route53Targets from 'aws-cdk-lib/aws-route53-targets';
import * as sns from 'aws-cdk-lib/aws-sns';
import * as waf from 'aws-cdk-lib/aws-wafv2';
import { Construct } from 'constructs';
import { Config } from './config/Config';

export interface PropsAPIResources extends cdk.StackProps {
    readonly domainName: string,
    readonly environment: string,
    readonly sampleCodeBucket: string,
    readonly certificateArn: string,
    readonly hostedZoneId: string,
    readonly apiDomainName: string,
    readonly isProduction: boolean,
}

export class APIResources extends cdk.Stack {
    constructor(scope: Construct, id: string, props: PropsAPIResources) {
        super(scope, id, props);
        const domainName = props.domainName;
        const golangCodeAsset = 'sample-code/golang-sample.zip';

        // Create a Private S3 Bucket with Public ACL for new objects enabled and Static Webhosting Enabled
        const { lambdaFunction, lambdaRole } = this.createLambdaFunctionAndRole(domainName, props, golangCodeAsset);

        // Create an API Gateway
        const apiObject = this.addAPIResources(props, lambdaFunction);

        // Create a Lambda permission for API Gateway to invoke the Lambda function
        const lambdaPermission = new lambda.CfnPermission(this, domainName + 'Permission', {
            action: 'lambda:InvokeFunction',
            functionName: lambdaFunction.functionArn,
            principal: 'apigateway.amazonaws.com',
            sourceArn: apiObject.api.arnForExecuteApi(),
        });

        // Create the WAF WebACL
        if (props.isProduction) {
            this.createWAF(domainName, apiObject.api);
        }

        this.createRecordSetsInRoute53(props, domainName, apiObject);


        // Add tags to the Lambda function
        cdk.Tags.of(lambdaFunction).add('environment', props.environment);
        cdk.Tags.of(lambdaFunction).add('project', Config.project);
        cdk.Tags.of(lambdaFunction).add('author', Config.author);
        cdk.Tags.of(lambdaFunction).add('site', props.apiDomainName);
        // Add tags to the DynamoDB
        cdk.Tags.of(apiObject.api).add('environment', props.environment);
        cdk.Tags.of(apiObject.api).add('project', Config.project);
        cdk.Tags.of(apiObject.api).add('author', Config.author);
        cdk.Tags.of(apiObject.api).add('site', props.apiDomainName);
        // Add tags to the Lambda permission
        cdk.Tags.of(lambdaPermission).add('environment', props.environment);
        cdk.Tags.of(lambdaPermission).add('project', Config.project);
        cdk.Tags.of(lambdaPermission).add('author', Config.author);
        cdk.Tags.of(lambdaPermission).add('site', props.apiDomainName);
        // Add tags to the Lambda function
        cdk.Tags.of(lambdaRole).add('environment', props.environment);
        cdk.Tags.of(lambdaRole).add('project', Config.project);
        cdk.Tags.of(lambdaRole).add('author', Config.author);
        cdk.Tags.of(lambdaRole).add('site', props.apiDomainName);
    }

    private createRecordSetsInRoute53(props: PropsAPIResources, domainName: string, apiObject: { api: cdk.aws_apigateway.RestApi; apiGatewayDomainName: cdk.aws_apigateway.DomainName; }) {
        // Create a hosted zone object using the hosted zone ID
        const hostedZone = route53.HostedZone.fromHostedZoneAttributes(this, 'HostedZone', {
            hostedZoneId: props.hostedZoneId,
            zoneName: props.apiDomainName,
        });

        // Create a A record in Route 53 for the custom domain name
        new route53.ARecord(this, 'ApiCnameRecord', {
            zone: hostedZone,
            recordName: props.apiDomainName,
            target: route53.RecordTarget.fromAlias(new route53Targets.ApiGatewayDomain(apiObject.apiGatewayDomainName)),
            comment: 'API Gateway CNAME Record for ' + domainName,
            deleteExisting: true
        });
    }

    private createLambdaFunctionAndRole(domainName: string, props: PropsAPIResources, golangCodeAsset: string) {
        const bucketName = domainName + '-archive';


        // Create an SNS topic for the dead letter notification
        const deadLetterTopic = new sns.Topic(this, props.environment + Config.project + 'DeadLetterTopic', {
            displayName: props.environment + Config.project + 'DeadLetterTopic',
            topicName: props.environment + "-" + Config.project + "-dead-letter-topic",
        });

        // Create IAM Role for the lambda function
        const lambdaRole = this.createLambdaRole(deadLetterTopic, props);

        // Create a Lambda function
        const lambdaFunction = new lambda.Function(this, domainName + 'Function', {
            runtime: lambda.Runtime.PROVIDED_AL2,
            handler: 'bootstrap',
            code: lambda.Code.fromAsset(golangCodeAsset),
            memorySize: 512,
            timeout: cdk.Duration.seconds(10),
            environment: {
                S3_BUCKET_NAME: bucketName
            },
            role: lambdaRole,
            retryAttempts: 0,
            description: props.environment + " Lambda Function to Save the Resources",
            functionName: props.environment + "-lambda-save-resources",
            deadLetterTopic: deadLetterTopic
        });

        // Add CloudWatch logs permission to the Lambda function's role
        const logGroupArn = `arn:aws:logs:${cdk.Aws.REGION}:${cdk.Aws.ACCOUNT_ID}:log-group:/aws/lambda/${lambdaFunction.functionName}:*`;
        const createLogGroupStatement = new iam.PolicyStatement({
            effect: iam.Effect.ALLOW,
            actions: ['logs:CreateLogGroup', 'logs:CreateLogStream', 'logs:PutLogEvents'],
            resources: [logGroupArn],
        });

        lambdaFunction.role?.attachInlinePolicy(
            new iam.Policy(this, 'createLogGroupPolicy', {
                statements: [createLogGroupStatement],
            })
        );
        return { lambdaFunction, lambdaRole };
    }

    private addAPIResources(props: PropsAPIResources, lambdaFunction: cdk.aws_lambda.Function) {
        const api = new apigateway.RestApi(this, props.apiDomainName, {
            restApiName: props.apiDomainName,
            description: props.apiDomainName + " API Gateway for the " + props.environment + " environment",
        });

        // Create an API Gateway resource "/save"
        const saveResource = api.root.addResource('save');

        // Create an API Gateway method "POST" and link it with the Lambda function
        saveResource.addMethod('POST', new apigateway.LambdaIntegration(lambdaFunction), {
            apiKeyRequired: true,
        });
        // Add OPTIONS method to the API Gateway resource
        saveResource.addMethod('OPTIONS', this.mockOptionsIntegration(props), {
            methodResponses: [
                {
                    statusCode: '200',
                    responseParameters: {
                        'method.response.header.Access-Control-Allow-Headers': true,
                        'method.response.header.Access-Control-Allow-Methods': true,
                        'method.response.header.Access-Control-Allow-Origin': true,
                    },
                },
            ],
        });

        // Create a usage plan
        const usagePlan = api.addUsagePlan('MyUsagePlan', {
            name: props.domainName + 'UsagePlan',
            description: props.domainName + ' Usage plan for My API',
            throttle: {
                rateLimit: 2000,
                burstLimit: 1000,
            },
            quota: {
                limit: 100000,
                period: apigateway.Period.MONTH,
            },
        });

        // Create an API key
        const apiKey = api.addApiKey('MyApiKey', {
            apiKeyName: props.domainName + 'ApiKey',
            description: props.domainName + ' API Key for My API',
        });

        // Associate the API key with the usage plan
        usagePlan.addApiKey(apiKey);

        // Grant the usage plan access to the API
        usagePlan.addApiStage({
            api: api,
            stage: api.deploymentStage,
        });

        // Attach the WAF ARN to the API Gateway
        const certificate = acm.Certificate.fromCertificateArn(this, props.apiDomainName + 'Certificate', props.certificateArn);
        const apiGatewayDomainName = new apigateway.DomainName(this, props.apiDomainName + 'ApiGatewayDomainName', {
            domainName: props.apiDomainName,
            certificate,
            endpointType: apigateway.EndpointType.EDGE,
        });

        // Add the base mapping
        apiGatewayDomainName.addBasePathMapping(api);

        return {
            api, apiGatewayDomainName
        };
    }

    private createLambdaRole(deadLetterTopic: sns.Topic, props: PropsAPIResources): iam.Role {
        // Create an IAM role for the Lambda function
        const lambdaRole = new iam.Role(this, props.domainName + 'Role', {
            assumedBy: new iam.ServicePrincipal('lambda.amazonaws.com'),
            description: props.environment + props.domainName + "Lambda Function Role",
            roleName: props.environment + Config.project + "LambdaFunctionRole",
        });

        // Add additional permissions
        deadLetterTopic.grantPublish(lambdaRole);

        return lambdaRole
    }

    private mockOptionsIntegration(props: PropsAPIResources): apigateway.MockIntegration {
        return new apigateway.MockIntegration({
            integrationResponses: [
                {
                    statusCode: '200',
                    responseParameters: {
                        'method.response.header.Access-Control-Allow-Headers': "'Content-Type,X-Amz-Date,Authorization,X-Api-Key,X-Amz-Security-Token'",
                        'method.response.header.Access-Control-Allow-Methods': "'GET,POST,OPTIONS'",
                        'method.response.header.Access-Control-Allow-Origin': "'https://" + props.domainName + "'",
                    },
                },
            ],
            passthroughBehavior: apigateway.PassthroughBehavior.WHEN_NO_MATCH,
            requestTemplates: {
                'application/json': '{"statusCode": 200}',
            },
        });
    }


    private createWAF(domainName: string, api: cdk.aws_apigateway.RestApi) {
        // Create IP sets for allowed IPs
        const ipSet1 = new waf.CfnIPSet(this, 'IPSet1', {
            addresses: ['192.0.2.0/24', '198.51.100.0/24'], // Example IPs, replace with your allowed IPs
            ipAddressVersion: 'IPV4',
            scope: 'REGIONAL',
            name: "office IP"
        });

        const ipSet2 = new waf.CfnIPSet(this, 'IPSet2', {
            addresses: ['203.0.113.0/24', '2001:0db8:85a3:0000:0000:8a2e:0370:7334'], // Example IPs, replace with your allowed IPs
            ipAddressVersion: 'IPV6',
            scope: 'REGIONAL',
            name: "remote Consultant Home IP"
        });

        // Create a rule group containing the IP sets
        const ruleGroup = new waf.CfnRuleGroup(this, 'IPRuleGroup', {
            capacity: 100,
            scope: 'REGIONAL',
            name: "Allow these IPs  from office and remote",
            visibilityConfig: {
                cloudWatchMetricsEnabled: true,
                metricName: 'IPRuleGroupMetrics',
                sampledRequestsEnabled: true,
            },
            rules: [
                {
                    name: 'AllowFromIPSet1',
                    priority: 1,
                    statement: {
                        ipSetReferenceStatement: {
                            arn: ipSet1.attrArn,
                        },
                    },
                    visibilityConfig: {
                        sampledRequestsEnabled: true,
                        cloudWatchMetricsEnabled: true,
                        metricName: 'AllowFromIPSet1',
                    },
                },
                {
                    name: 'AllowFromIPSet2',
                    priority: 2,
                    statement: {
                        ipSetReferenceStatement: {
                            arn: ipSet2.attrArn,
                        },
                    },
                    visibilityConfig: {
                        sampledRequestsEnabled: true,
                        cloudWatchMetricsEnabled: true,
                        metricName: 'AllowFromIPSet2',
                    },
                },
            ],
        });

        const webACL = new waf.CfnWebACL(this, domainName + 'MyWebACL', {
            description: "API ACL for the " + domainName + " API Gateway",
            defaultAction: { block: {} }, // blocks all requests by default
            scope: 'REGIONAL',
            visibilityConfig: {
                cloudWatchMetricsEnabled: true,
                metricName: 'MyWebACLMetrics',
                sampledRequestsEnabled: true,
            },
            rules: [
                {
                    name: 'IPRuleGroupRule',
                    priority: 1,
                    statement: {
                        ruleGroupReferenceStatement: {
                            arn: ruleGroup.attrArn,
                        },
                    },
                    visibilityConfig: {
                        sampledRequestsEnabled: true,
                        cloudWatchMetricsEnabled: true,
                        metricName: 'IPRuleGroupRule',
                    },
                },
            ],
        });

        // Enable WAF for the API Gateway
        api.node.addDependency(webACL);

        // Associate the WebACL with the stage
        const wafAssociation = new waf.CfnWebACLAssociation(this, 'WebACLAssociation', {
            webAclArn: webACL.attrArn,
            resourceArn: api.deploymentStage.stageArn,
        });
    }
}