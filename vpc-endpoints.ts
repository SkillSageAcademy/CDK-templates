import * as cdk from 'aws-cdk-lib';
import * as ec2 from 'aws-cdk-lib/aws-ec2';
import * as iam from 'aws-cdk-lib/aws-iam';
import * as lambda from 'aws-cdk-lib/aws-lambda';
import * as rds from 'aws-cdk-lib/aws-rds';
import { Construct } from 'constructs';

export interface VPCEndpointResources extends cdk.StackProps {
}

export class VPCEndpoint extends cdk.Stack {
    constructor(scope: Construct, id: string, props: VPCEndpointResources) {
        super(scope, id, props);

        const vpc = new ec2.Vpc(this, 'MyVPC', {
            maxAzs: 2,
            subnetConfiguration: [
                {
                    subnetType: ec2.SubnetType.PRIVATE_ISOLATED,
                    name: 'PrivateSubnet',
                    cidrMask: 24,
                },
                {
                    name: 'public',
                    subnetType: ec2.SubnetType.PUBLIC,
                    cidrMask: 24
                },
                {
                    name: 'isolated',
                    subnetType: ec2.SubnetType.PRIVATE_ISOLATED,
                    cidrMask: 28
                }
            ],
            enableDnsSupport: true,
            enableDnsHostnames: true,
        });

        const dynamoDbGatewayEndpoint = new ec2.GatewayVpcEndpoint(this, 'DynamoDbEndpoint', {
            vpc,
            service: ec2.GatewayVpcEndpointAwsService.DYNAMODB,
        });

        const snsEndpoint = new ec2.InterfaceVpcEndpoint(this, 'SnsEndpoint', {
            vpc,
            service: ec2.InterfaceVpcEndpointAwsService.SNS,
            securityGroups: [
                ec2.SecurityGroup.fromSecurityGroupId(
                    this,
                    'SecretsManagerVPCEndpointSG',
                    'sg-exampleID',
                    {}
                )
            ]
        });

        const secretsManagerEndpoint = new ec2.InterfaceVpcEndpoint(this, 'SecretsManagerEndpoint', {
            vpc,
            service: ec2.InterfaceVpcEndpointAwsService.SECRETS_MANAGER,
            securityGroups: [
                ec2.SecurityGroup.fromSecurityGroupId(
                    this,
                    'SecretsManagerVPCEndpointSG',
                    'sg-exampleID',
                    {}
                )
            ]
        });

        // This allows to customize the endpoint policy
        dynamoDbGatewayEndpoint.addToPolicy(
            new iam.PolicyStatement({ // Restrict to listing and describing tables
                principals: [new iam.AnyPrincipal()],
                actions: ['dynamodb:DescribeTable', 'dynamodb:ListTables'],
                resources: ['*'],
            }));


        secretsManagerEndpoint.addToPolicy(
            new iam.PolicyStatement({
                // Restrict to listing and describing tables
                principals: [new iam.AnyPrincipal()],
                actions: ['secretsmanager:GetSecretValue'],
                resources: [
                    '*'
                ]
            })
        );

        const rdsInstance = new rds.DatabaseInstance(this, 'MyRDS', {
            engine: rds.DatabaseInstanceEngine.POSTGRES,
            instanceType: ec2.InstanceType.of(ec2.InstanceClass.BURSTABLE2, ec2.InstanceSize.MICRO),
            vpc,
            vpcSubnets: {
                subnetType: ec2.SubnetType.PRIVATE_ISOLATED,
            },
            allowMajorVersionUpgrade: true,
            autoMinorVersionUpgrade: true,
            removalPolicy: cdk.RemovalPolicy.DESTROY,
            storageEncrypted: true,
            monitoringInterval: cdk.Duration.seconds(60),
            enablePerformanceInsights: true,
            publiclyAccessible: false
        });

        const lambdaRole = new iam.Role(this, 'LambdaRole', {
            assumedBy: new iam.ServicePrincipal('lambda.amazonaws.com'),
        });

        lambdaRole.addManagedPolicy(iam.ManagedPolicy.fromAwsManagedPolicyName('service-role/AWSLambdaBasicExecutionRole'));

        const lambdaFunction = new lambda.Function(this, 'MyLambdaFunction', {
            runtime: lambda.Runtime.NODEJS_16_X,
            handler: 'index.handler',
            code: lambda.Code.fromAsset('lambda'),
            vpc,
            role: lambdaRole,
            securityGroups: [
                ec2.SecurityGroup.fromSecurityGroupId(
                    this,
                    'lambdaFunctionSG',
                    'sg-exampleID',
                    {}
                )
            ]
        });


        snsEndpoint.connections.allowFrom(lambdaFunction, ec2.Port.tcp(443));
        secretsManagerEndpoint.connections.allowFrom(lambdaFunction, ec2.Port.tcp(443));
    }
}