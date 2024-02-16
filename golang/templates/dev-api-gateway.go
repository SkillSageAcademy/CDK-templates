package templates

import (
	"path/filepath"

	"github.com/aws/aws-cdk-go/awscdk/v2"
	"github.com/aws/aws-cdk-go/awscdk/v2/awsacm"
	"github.com/aws/aws-cdk-go/awscdk/v2/awsapigateway"
	"github.com/aws/aws-cdk-go/awscdk/v2/awsiam"
	"github.com/aws/aws-cdk-go/awscdk/v2/awslambda"
	"github.com/aws/aws-cdk-go/awscdk/v2/awsroute53"
	"github.com/aws/aws-cdk-go/awscdk/v2/awsroute53targets"
	"github.com/aws/aws-cdk-go/awscdk/v2/awssns"
	"github.com/aws/aws-sdk-go/aws"
	"github.com/aws/constructs-go/constructs/v10"
	"github.com/aws/jsii-runtime-go"
)

type PropsAPIResources struct {
	awscdk.StackProps
	DomainName       string
	Environment      string
	SampleCodeBucket string
	CertificateArn   string
	HostedZoneId     string
	ApiDomainName    string
	IsProduction     bool
}

type APIResources struct {
	awscdk.Stack
}

type APIObject struct {
	api                  awsapigateway.IRestApi
	ApiGatewayDomainName awsapigateway.IDomainName
}

type Config struct {
	project string
	author  string
}

// Initialize Config
var config = Config{
	project: "YourProjectName",
	author:  "YourName",
}

func NewAPIResources(scope constructs.Construct, id string, props *PropsAPIResources) *APIResources {
	self := &APIResources{
		awscdk.NewStack(scope, &id, &props.StackProps),
	}

	domainName := props.DomainName
	golangCodeAsset := "sample-code/golang-sample.zip"

	lambdaFunction, lambdaRole := self.createLambdaFunctionAndRole(domainName, props, golangCodeAsset)

	apiObject := self.addAPIResources(props, lambdaFunction)

	// Create a Lambda permission for API Gateway to invoke the Lambda function
	awslambda.NewCfnPermission(self, aws.String(domainName+"Permission"), &awslambda.CfnPermissionProps{
		Action:      aws.String("lambda:InvokeFunction"),
		Principal:   aws.String("apigateway.amazonaws.com"),
		SourceArn:   apiObject.api.RestApiId(),
		FunctionName: lambdaFunction.FunctionName(),
	})

	self.createRecordSetsInRoute53(props, domainName, apiObject)

	self.addTags(lambdaFunction.LatestVersion().Stack(), props)
	self.addTags(apiObject.api.Stack(), props)
	self.addTags(lambdaRole.Stack(), props)

	return self
}

func (self *APIResources) createRecordSetsInRoute53(props *PropsAPIResources, domainName string, apiObject *APIObject) {
	hostedZone := awsroute53.HostedZone_FromHostedZoneAttributes(self, jsii.String("HZA"+*apiObject.api.RestApiName()), &awsroute53.HostedZoneAttributes{
		HostedZoneId: &props.HostedZoneId,
		ZoneName:     &props.ApiDomainName,
	})

	// Create an alias record target for the API Gateway domain name
	apiGatewayDomainTarget := awsroute53targets.NewApiGatewayDomain(apiObject.ApiGatewayDomainName)

	// Create a A record in Route 53 for the custom domain name
	awsroute53.NewARecord(self, jsii.String("ARecord"+*apiObject.api.RestApiName()), &awsroute53.ARecordProps{
		Zone:           hostedZone,
		RecordName:     &props.ApiDomainName,
		Target:         awsroute53.RecordTarget_FromAlias(apiGatewayDomainTarget),
		Comment:        jsii.String("API Gateway CNAME Record for " + domainName),
		DeleteExisting: jsii.Bool(true),
	})

}

func (self *APIResources) createLambdaFunctionAndRole(domainName string, props *PropsAPIResources, golangCodeAsset string) (awslambda.IFunction, awsiam.IRole) {
	bucketName := domainName + "-archive"

	deadLetterTopic := awssns.NewTopic(self, jsii.String("topic"+domainName), &awssns.TopicProps{
		DisplayName: jsii.String(props.Environment + config.project + "DeadLetterTopic"),
		TopicName:   jsii.String(props.Environment + "-" + config.project + "-dead-letter-topic"),
	})

	lambdaRole := self.createLambdaRole(deadLetterTopic, props)

	seconds := float64(10)
	dir := filepath.Dir(golangCodeAsset)
	lambdaFunction := awslambda.NewFunction(self, jsii.String("lambda"+domainName), &awslambda.FunctionProps{
		Runtime:         awslambda.Runtime_PROVIDED_AL2(),
		Handler:         jsii.String("bootstrap"),
		Code:            awslambda.Code_FromAsset(&dir, nil),
		MemorySize:      jsii.Number(512),
		Timeout:         awscdk.Duration_Seconds(&seconds),
		Environment:     &map[string]*string{"S3_BUCKET_NAME": &bucketName},
		Role:            lambdaRole,
		RetryAttempts:   jsii.Number(0),
		Description:     jsii.String(props.Environment + " Lambda Function to Save the Resources"),
		FunctionName:    jsii.String(props.Environment + "-lambda-save-resources"),
		DeadLetterTopic: deadLetterTopic,
	})

	logGroupArn := jsii.Sprintf("arn:aws:logs:%s:%s:log-group:/aws/lambda/%s:*", *awscdk.Aws_REGION(), *awscdk.Aws_ACCOUNT_ID(), lambdaFunction.FunctionName())

	createLogGroupStatement := awsiam.NewPolicyStatement(&awsiam.PolicyStatementProps{
		Effect:    awsiam.Effect_ALLOW,
		Actions:   &[]*string{jsii.String("logs:CreateLogGroup"), jsii.String("logs:CreateLogStream"), jsii.String("logs:PutLogEvents")},
		Resources: &[]*string{logGroupArn},
	})

	// provide permissions to describe the user pool scoped to the ARN the user pool
	lambdaFunction.Role().AttachInlinePolicy(awsiam.NewPolicy(self, jsii.String("userpool-policy"), &awsiam.PolicyProps{
		Statements: &[]awsiam.PolicyStatement{
			createLogGroupStatement,
		},
	}))

	return lambdaFunction, lambdaRole
}

func (self *APIResources) addAPIResources(props *PropsAPIResources, lambdaFunction awslambda.IFunction) *APIObject {
	api := awsapigateway.NewRestApi(self, &props.ApiDomainName, &awsapigateway.RestApiProps{
		RestApiName: jsii.String(props.ApiDomainName),
		Description: jsii.String(props.ApiDomainName + " API Gateway for the " + props.Environment + " environment"),
	})

	saveResource := api.Root().AddResource(jsii.String("save"), nil)

	saveResource.AddMethod(jsii.String("POST"), awsapigateway.NewLambdaIntegration(lambdaFunction, nil), &awsapigateway.MethodOptions{
		ApiKeyRequired: jsii.Bool(true),
	})

	saveResource.AddMethod(jsii.String("OPTIONS"), self.mockOptionsIntegration(props), &awsapigateway.MethodOptions{
		MethodResponses: &[]*awsapigateway.MethodResponse{
			{
				StatusCode: jsii.String("200"),
				ResponseParameters: &map[string]*bool{
					"method.response.header.Access-Control-Allow-Headers": jsii.Bool(true),
					"method.response.header.Access-Control-Allow-Methods": jsii.Bool(true),
					"method.response.header.Access-Control-Allow-Origin":  jsii.Bool(true),
				},
			},
		},
	})

	usagePlan := api.AddUsagePlan(jsii.String("MyUsagePlan"), &awsapigateway.UsagePlanProps{
		Name:        jsii.String(props.DomainName + "UsagePlan"),
		Description: jsii.String(props.DomainName + " Usage plan for My API"),
		Throttle: &awsapigateway.ThrottleSettings{
			RateLimit:  jsii.Number(2000),
			BurstLimit: jsii.Number(1000),
		},
		Quota: &awsapigateway.QuotaSettings{
			Limit:  jsii.Number(100000),
			Period: awsapigateway.Period_MONTH,
		},
	})

	apiKey := api.AddApiKey(jsii.String("MyApiKey"), &awsapigateway.ApiKeyOptions{
		ApiKeyName:  jsii.String(props.DomainName + "ApiKey"),
		Description: jsii.String(props.DomainName + " API Key for My API"),
	})

	usagePlan.AddApiKey(apiKey, &awsapigateway.AddApiKeyOptions{})

	usagePlan.AddApiStage(&awsapigateway.UsagePlanPerApiStage{
		Api:   api,
		Stage: api.DeploymentStage(),
	})

	certificate := awsacm.Certificate_FromCertificateArn(self, jsii.Sprintf("%sCertificate", props.ApiDomainName), &props.CertificateArn)

	apiGatewayDomainName := awsapigateway.NewDomainName(self, jsii.Sprintf("%sApiGatewayDomainName", props.ApiDomainName), &awsapigateway.DomainNameProps{
		DomainName:   &props.ApiDomainName,
		Certificate:  certificate,
		EndpointType: awsapigateway.EndpointType_EDGE,
	})

	apiGatewayDomainName.AddBasePathMapping(api, &awsapigateway.BasePathMappingOptions{})

	return &APIObject{api: api, ApiGatewayDomainName: apiGatewayDomainName}
}

func (self *APIResources) mockOptionsIntegration(props *PropsAPIResources) awsapigateway.MockIntegration {
	return awsapigateway.NewMockIntegration(&awsapigateway.IntegrationOptions{
		IntegrationResponses: &[]*awsapigateway.IntegrationResponse{
			{
				StatusCode: jsii.String("200"),
				ResponseParameters: &map[string]*string{
					"method.response.header.Access-Control-Allow-Headers": jsii.String("'Content-Type,X-Amz-Date,Authorization,X-Api-Key,X-Amz-Security-Token'"),
					"method.response.header.Access-Control-Allow-Methods": jsii.String("'GET,POST,OPTIONS'"),
					"method.response.header.Access-Control-Allow-Origin":  jsii.String("'https://" + props.DomainName + "'"),
				},
			},
		},
		PassthroughBehavior: awsapigateway.PassthroughBehavior_WHEN_NO_MATCH,
		RequestTemplates: &map[string]*string{
			"application/json": jsii.String(`{"statusCode": 200}`),
		},
	})
}

func (self *APIResources) createLambdaRole(deadLetterTopic awssns.ITopic, props *PropsAPIResources) awsiam.IRole {
	lambdaFunctionRole := jsii.Sprintf("%s%sLambda Function Role", props.Environment, props.DomainName)
	lambdaFunctionRoleName := jsii.Sprintf("%s%sLambdaFunctionRole", props.Environment, config.project)
	lambdaRole := awsiam.NewRole(self, jsii.Sprintf("%sRole", props.DomainName), &awsiam.RoleProps{
		AssumedBy:   awsiam.NewServicePrincipal(jsii.String("lambda.amazonaws.com"), nil),
		Description: jsii.String(*lambdaFunctionRole),
		RoleName:    jsii.String(*lambdaFunctionRoleName),
	})

	deadLetterTopic.GrantPublish(lambdaRole)

	return lambdaRole
}

func (self *APIResources) addTags(resource awscdk.ITaggable, props *PropsAPIResources) {
	resource.Tags().SetTag(jsii.String("environment"), jsii.String(props.Environment), jsii.Number(1), jsii.Bool(true))
	resource.Tags().SetTag(jsii.String("project"), jsii.String(config.project), jsii.Number(2), jsii.Bool(true))
	resource.Tags().SetTag(jsii.String("author"), jsii.String(config.author), jsii.Number(3), jsii.Bool(true))
	resource.Tags().SetTag(jsii.String("site"), jsii.String(props.ApiDomainName), jsii.Number(4), jsii.Bool(true))
}
