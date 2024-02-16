package templates

import (
	"github.com/aws/aws-cdk-go/awscdk/v2"
	"github.com/aws/aws-cdk-go/awscdk/v2/awsec2"
	"github.com/aws/aws-cdk-go/awscdk/v2/awsiam"
	"github.com/aws/aws-cdk-go/awscdk/v2/awslambda"
	"github.com/aws/aws-cdk-go/awscdk/v2/awsrds"
	"github.com/aws/constructs-go/constructs/v10"
	"github.com/aws/jsii-runtime-go"
)

type VPCEndpointStackProps struct {
	constructs.Construct
}

func NewVPCEndpointStack(scope constructs.Construct, id string, props *VPCEndpointStackProps) constructs.Construct {
	stack := constructs.NewConstruct(scope, &id)

	// Create a VPC
	vpc := awsec2.NewVpc(stack, jsii.String("MyVPC"), &awsec2.VpcProps{
		MaxAzs: jsii.Number(2),
		SubnetConfiguration: &[]*awsec2.SubnetConfiguration{
			{
				CidrMask:   jsii.Number(24),
				Name:       jsii.String("Public"),
				SubnetType: awsec2.SubnetType_PUBLIC,
			},
			{
				CidrMask:   jsii.Number(24),
				Name:       jsii.String("Private"),
				SubnetType: awsec2.SubnetType_PRIVATE_WITH_EGRESS,
			},
			{
				CidrMask:   jsii.Number(24),
				Name:       jsii.String("Private"),
				SubnetType: awsec2.SubnetType_PRIVATE_ISOLATED,
			},
		},
	})

	// Create DynamoDB Gateway VPC Endpoint
	dynamoDbGatewayEndpoint := awsec2.NewGatewayVpcEndpoint(stack, jsii.String("DynamoDbEndpoint"), &awsec2.GatewayVpcEndpointProps{
		Vpc:     vpc,
		Service: awsec2.GatewayVpcEndpointAwsService_DYNAMODB(),
	})

	// Create Secrets Manager Interface VPC Endpoint
	secretsManagerEndpoint := awsec2.NewInterfaceVpcEndpoint(stack, jsii.String("SecretsManagerEndpoint"), &awsec2.InterfaceVpcEndpointProps{
		Vpc:     vpc,
		Service: awsec2.InterfaceVpcEndpointAwsService_SECRETS_MANAGER(),
		SecurityGroups: &[]awsec2.ISecurityGroup{
			awsec2.SecurityGroup_FromSecurityGroupId(stack, jsii.String("SecretsManagerVPCEndpointSG"), jsii.String("sg-exampleID"), &awsec2.SecurityGroupImportOptions{}),
		},
	})

	// Create Secrets Manager Interface VPC Endpoint
	snsEndpoint := awsec2.NewInterfaceVpcEndpoint(stack, jsii.String("SNSEndpoint"), &awsec2.InterfaceVpcEndpointProps{
		Vpc:     vpc,
		Service: awsec2.InterfaceVpcEndpointAwsService_SNS(),
		SecurityGroups: &[]awsec2.ISecurityGroup{
			awsec2.SecurityGroup_FromSecurityGroupId(stack, jsii.String("SNSVPCEndpointSG"), jsii.String("sg-exampleID"), &awsec2.SecurityGroupImportOptions{}),
		},
	})

	// Customize endpoint policies
	dynamoDbGatewayEndpoint.AddToPolicy(awsiam.NewPolicyStatement(&awsiam.PolicyStatementProps{
		Principals: &[]awsiam.IPrincipal{awsiam.NewAnyPrincipal()},
		Actions:    jsii.Strings("dynamodb:DescribeTable", "dynamodb:ListTables"),
		Resources:  jsii.Strings("*"),
	}))

	secretsManagerEndpoint.AddToPolicy(awsiam.NewPolicyStatement(&awsiam.PolicyStatementProps{
		Principals: &[]awsiam.IPrincipal{awsiam.NewAnyPrincipal()},
		Actions:    jsii.Strings("secretsmanager:GetSecretValue"),
		Resources:  jsii.Strings("*"),
	}))

	// Create RDS Instance
	seconds := float64(64)
	awsrds.NewDatabaseInstance(stack, jsii.String("MyRDS"), &awsrds.DatabaseInstanceProps{
		Engine:                    awsrds.DatabaseInstanceEngine_POSTGRES(),
		InstanceType:              awsec2.InstanceType_Of(awsec2.InstanceClass_BURSTABLE2, awsec2.InstanceSize_MICRO),
		Vpc:                       vpc,
		VpcSubnets:                &awsec2.SubnetSelection{SubnetType: awsec2.SubnetType_PRIVATE_ISOLATED},
		AllowMajorVersionUpgrade:  jsii.Bool(true),
		AutoMinorVersionUpgrade:   jsii.Bool(true),
		RemovalPolicy:             awscdk.RemovalPolicy_DESTROY,
		StorageEncrypted:          jsii.Bool(true),
		MonitoringInterval:        awscdk.Duration_Seconds(&seconds),
		EnablePerformanceInsights: jsii.Bool(true),
		PubliclyAccessible:        jsii.Bool(false),
	})

	// Create Lambda Role
	lambdaRole := awsiam.NewRole(stack, jsii.String("LambdaRole"), &awsiam.RoleProps{
		AssumedBy: awsiam.NewServicePrincipal(jsii.String("lambda.amazonaws.com"), nil),
	})

	lambdaRole.AddManagedPolicy(awsiam.ManagedPolicy_FromAwsManagedPolicyName(jsii.String("service-role/AWSLambdaBasicExecutionRole")))

	// Create Lambda Function
	lambdaFunction := awslambda.NewFunction(stack, jsii.String("MyLambdaFunction"), &awslambda.FunctionProps{
		Runtime: awslambda.Runtime_NODEJS_20_X(),
		Handler: jsii.String("index.handler"),
		Code:    awslambda.Code_FromAsset(jsii.String("lambda"), nil),
		Vpc:     vpc,
		Role:    lambdaRole,
		SecurityGroups: &[]awsec2.ISecurityGroup{
			awsec2.SecurityGroup_FromSecurityGroupId(stack, jsii.String("lambdaFunctionSG"), jsii.String("sg-exampleID"), &awsec2.SecurityGroupImportOptions{}),
		},
	})

	// Allow connections to endpoints from Lambda Function
	httpsPort := float64(443)
	snsEndpoint.Connections().AllowFrom(lambdaFunction, awsec2.Port_Tcp(&httpsPort), nil)
	secretsManagerEndpoint.Connections().AllowFrom(lambdaFunction, awsec2.Port_Tcp(&httpsPort), nil)

	return stack
}

func main() {
	app := awscdk.NewApp(nil)

	NewVPCEndpointStack(app, "VPCEndpointStack", &VPCEndpointStackProps{
		constructs.NewConstruct(nil, nil),
	})

	app.Synth(nil)
}
